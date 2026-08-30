#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import platform
import sys
import urllib.request
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
DEFAULT_RELEASE = APP_DIR / "model-sources" / "release.json"
DEFAULT_STAGE_ROOT = APP_DIR / ".tmp_model_release"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path, expected_bytes, expected_sha256):
    if not path.is_file():
        raise ValueError(f"Missing file: {path}")
    actual_bytes = path.stat().st_size
    if actual_bytes != expected_bytes:
        raise ValueError(f"{path.name} has {actual_bytes} bytes, expected {expected_bytes}")
    actual_sha256 = sha256(path)
    if actual_sha256 != expected_sha256:
        raise ValueError(f"{path.name} SHA-256 mismatch: {actual_sha256}")


def load_release(path, model_id, model_version):
    release = json.loads(path.read_text())
    source_dir = path.parent
    matches = []
    for model in release["models"]:
        config = json.loads((source_dir / model["config"]["path"]).read_text())
        version = "0.0" if float(config["model"]["version"]) == 0 else str(config["model"]["version"])
        if model["id"] == model_id and version == model_version:
            matches.append((model, config))
    if len(matches) != 1:
        raise ValueError(f"Expected one {model_id} v{model_version} descriptor, found {len(matches)}")
    return release, matches[0][0], matches[0][1]


def acquire_checkpoint(model, stage_dir):
    source = model["source"]
    required = ["checkpointUrl", "checkpointFilename", "checkpointBytes", "checkpointSha256"]
    missing = [field for field in required if not source.get(field)]
    if missing:
        raise ValueError(f"Source descriptor lacks checkpoint fields: {', '.join(missing)}")

    checkpoint = stage_dir / source["checkpointFilename"]
    try:
        verify_file(checkpoint, source["checkpointBytes"], source["checkpointSha256"])
        print(f"Using verified checkpoint: {checkpoint}")
        return checkpoint
    except ValueError:
        if checkpoint.exists():
            checkpoint.unlink()

    partial = checkpoint.with_suffix(checkpoint.suffix + ".partial")
    if partial.exists():
        partial.unlink()
    print(f"Downloading {source['checkpointUrl']}")
    try:
        urllib.request.urlretrieve(source["checkpointUrl"], partial)
        verify_file(partial, source["checkpointBytes"], source["checkpointSha256"])
        partial.replace(checkpoint)
    finally:
        if partial.exists():
            partial.unlink()
    return checkpoint


def build_model(config, checkpoint_path):
    import torch
    from monai.networks.nets import UNet

    model_config = config["model"]
    model = UNet(
        spatial_dims=model_config["spatial_dims"],
        in_channels=model_config["in_channels"],
        out_channels=model_config["out_channels"],
        channels=model_config["channels"],
        strides=model_config["strides"],
        num_res_units=model_config["num_res_units"],
        act=model_config["act"],
        norm=model_config["norm"],
    )
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint:
        checkpoint = checkpoint["model_state_dict"]
    elif isinstance(checkpoint, dict) and "state_dict" in checkpoint:
        checkpoint = checkpoint["state_dict"]
    model.load_state_dict(checkpoint)
    model.eval()
    return model


def export_fp32(model, output_path, roi_size):
    import torch

    torch.manual_seed(0)
    dummy = torch.randn(1, 1, roi_size[0], roi_size[1], dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        output_path,
        opset_version=17,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={
            "input": {0: "batch", 2: "height", 3: "width"},
            "output": {0: "batch", 2: "height", 3: "width"},
        },
        dynamo=False,
    )


def quantize(fp32_path, q8_path):
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(fp32_path, q8_path, weight_type=QuantType.QUInt8)


def create_browser_reference_fixtures(model, stage_dir, roi):
    import numpy as np
    import torch

    fixture_dir = stage_dir / "browser-reference"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(14)
    fixtures = []
    samples = []
    with torch.no_grad():
        for case_index in range(3):
            sample = rng.normal(size=(1, 1, roi[0], roi[1])).astype(np.float32)
            reference_output = model(torch.from_numpy(sample)).numpy()
            expected_argmax = np.argmax(reference_output, axis=1).astype(np.uint8)
            input_path = fixture_dir / f"case-{case_index}-input-f32.bin"
            expected_path = fixture_dir / f"case-{case_index}-argmax-u8.bin"
            input_path.write_bytes(sample.tobytes(order="C"))
            expected_path.write_bytes(expected_argmax.tobytes(order="C"))
            fixtures.append({
                "case": case_index,
                "inputPath": str(input_path.relative_to(stage_dir)),
                "inputBytes": input_path.stat().st_size,
                "inputSha256": sha256(input_path),
                "expectedArgmaxPath": str(expected_path.relative_to(stage_dir)),
                "expectedArgmaxBytes": expected_path.stat().st_size,
                "expectedArgmaxSha256": sha256(expected_path),
                "expectedClasses": [int(value) for value in np.unique(expected_argmax)],
            })
            samples.append((sample, reference_output))
    return fixtures, samples


def validate_candidate(candidate_path, config, precision, samples):
    import numpy as np
    import onnx
    import onnxruntime as ort

    onnx_model = onnx.load(candidate_path)
    onnx.checker.check_model(onnx_model)
    session = ort.InferenceSession(str(candidate_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_shape = session.get_outputs()[0].shape
    expected_channels = config["model"]["out_channels"]
    if output_shape[1] != expected_channels:
        raise ValueError(f"ONNX output has {output_shape[1]} channels, expected {expected_channels}")

    cases = []
    numerically_equivalent = True
    argmax_matches = []
    for case_index, (sample, pytorch_output) in enumerate(samples):
        onnx_output = session.run(None, {input_name: sample})[0]
        max_abs = float(np.max(np.abs(pytorch_output - onnx_output)))
        mean_abs = float(np.mean(np.abs(pytorch_output - onnx_output)))
        case_equivalent = max_abs <= 5e-4 and mean_abs <= 5e-5
        argmax_match = float(np.mean(
            np.argmax(pytorch_output, axis=1) == np.argmax(onnx_output, axis=1)
        ))
        numerically_equivalent = numerically_equivalent and case_equivalent
        argmax_matches.append(argmax_match)
        cases.append({
            "case": case_index,
            "maxAbsError": max_abs,
            "meanAbsError": mean_abs,
            "maxAbsErrorAtMost0.0005AndMeanAbsErrorAtMost0.00005": case_equivalent,
            "argmaxAgreement": argmax_match,
        })

    passed = (
        numerically_equivalent and min(argmax_matches) == 1.0
        if precision == "fp32"
        else min(argmax_matches) >= 0.99
    )
    if not passed:
        requirement = (
            "max absolute error <=5e-4, mean absolute error <=5e-5, and 100% argmax agreement"
            if precision == "fp32"
            else "99% argmax agreement"
        )
        raise ValueError(f"{precision} candidate failed random-patch validation: {requirement}")
    return cases


def tool_versions():
    import monai
    import numpy
    import onnx
    import onnxruntime
    import torch

    return {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "monai": monai.__version__,
        "numpy": numpy.__version__,
        "onnx": onnx.__version__,
        "onnxruntime": onnxruntime.__version__,
        "platform": platform.platform(),
    }


def write_report(path, release, model, config, checkpoint, candidates, browser_reference_fixtures):
    report = {
        "schemaVersion": 1,
        "status": "structural-and-random-patch-passed",
        "fixtureValidation": "required-before-publication",
        "model": {
            "id": model["id"],
            "version": str(config["model"]["version"]),
            "labelSpaceId": model["labelSpaceId"],
            "outChannels": config["model"]["out_channels"],
            "numResUnits": config["model"]["num_res_units"],
            "roiSize": config["parameters"]["roi_size"],
        },
        "source": {
            "record": model["source"]["record"],
            "doi": model["source"]["doi"],
            "checkpoint": checkpoint.name,
            "checkpointBytes": checkpoint.stat().st_size,
            "checkpointSha256": sha256(checkpoint),
            "upstreamRevision": release["upstream"]["revision"],
        },
        "tools": tool_versions(),
        "browserReferenceFixtures": browser_reference_fixtures,
        "candidates": candidates,
    }
    path.write_text(json.dumps(report, indent=2) + "\n")
    return report


def parse_args():
    parser = argparse.ArgumentParser(description="Acquire and convert a pinned MuscleMap model")
    parser.add_argument("--release", type=Path, default=DEFAULT_RELEASE)
    parser.add_argument("--model-id", default="wholebody")
    parser.add_argument("--model-version", default="1.4")
    parser.add_argument("--stage-dir", type=Path, default=None)
    parser.add_argument("--precision", choices=["fp32", "q8", "both"], default="fp32")
    parser.add_argument("--checkpoint", type=Path, default=None)
    return parser.parse_args()


def main():
    args = parse_args()
    release_path = args.release.resolve()
    release, model, config = load_release(release_path, args.model_id, args.model_version)
    stage_dir = (args.stage_dir or DEFAULT_STAGE_ROOT / f"{args.model_id}-v{args.model_version}").resolve()
    stage_dir.mkdir(parents=True, exist_ok=True)

    checkpoint = args.checkpoint.resolve() if args.checkpoint else acquire_checkpoint(model, stage_dir)
    verify_file(
        checkpoint,
        model["source"]["checkpointBytes"],
        model["source"]["checkpointSha256"],
    )
    pytorch_model = build_model(config, checkpoint)
    browser_reference_fixtures, validation_samples = create_browser_reference_fixtures(
        pytorch_model,
        stage_dir,
        config["parameters"]["roi_size"],
    )

    base_name = f"musclemap-{args.model_id}-v{args.model_version}"
    fp32_path = stage_dir / f"{base_name}-fp32.onnx"
    candidates = []

    if args.precision in {"fp32", "both", "q8"}:
        print(f"Exporting FP32 candidate: {fp32_path}")
        export_fp32(pytorch_model, fp32_path, config["parameters"]["roi_size"])
        cases = validate_candidate(fp32_path, config, "fp32", validation_samples)
        candidates.append({
            "precision": "fp32",
            "path": fp32_path.name,
            "bytes": fp32_path.stat().st_size,
            "sha256": sha256(fp32_path),
            "validation": cases,
        })

    if args.precision in {"q8", "both"}:
        q8_path = stage_dir / f"{base_name}-q8.onnx"
        print(f"Exporting Q8 candidate: {q8_path}")
        quantize(fp32_path, q8_path)
        cases = validate_candidate(q8_path, config, "q8", validation_samples)
        candidates.append({
            "precision": "q8",
            "path": q8_path.name,
            "bytes": q8_path.stat().st_size,
            "sha256": sha256(q8_path),
            "validation": cases,
        })

    report_path = stage_dir / "conversion-report.json"
    write_report(
        report_path,
        release,
        model,
        config,
        checkpoint,
        candidates,
        browser_reference_fixtures,
    )
    print(f"Wrote {report_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3

import argparse
import hashlib
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np
import onnxruntime as ort
import torch
from scipy.ndimage import zoom

import convert_model


SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
DEFAULT_RELEASE = APP_DIR / "model-sources" / "release.json"
DEFAULT_STAGE = APP_DIR / ".tmp_model_release" / "wholebody-v1.4"


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_fixture_path(manifest_path, value):
    path = Path(value)
    return path if path.is_absolute() else (manifest_path.parent / path).resolve()


def preprocess(path, target_spacing, margin):
    image = nib.as_closest_canonical(nib.load(path))
    data = image.get_fdata(dtype=np.float32)
    source_spacing = np.asarray(image.header.get_zooms()[:3], dtype=np.float64)
    destination_spacing = np.asarray([
        source_spacing[index] if spacing < 0 else spacing
        for index, spacing in enumerate(target_spacing)
    ])
    factors = source_spacing / destination_spacing
    if not np.allclose(factors, 1.0, atol=0.01):
        data = zoom(data, factors, order=1).astype(np.float32, copy=False)

    nonzero = data != 0
    if not nonzero.any():
        raise ValueError(f"Fixture has no nonzero voxels: {path}")
    values = data[nonzero]
    deviation = float(values.std()) or 1.0
    normalized = np.zeros_like(data, dtype=np.float32)
    normalized[nonzero] = (values - float(values.mean())) / deviation

    coordinates = np.argwhere(nonzero)
    start = np.maximum(coordinates.min(axis=0) - margin, 0)
    end = np.minimum(coordinates.max(axis=0) + 1 + margin, normalized.shape)
    return normalized[
        start[0]:end[0],
        start[1]:end[1],
        start[2]:end[2]
    ]


def tile_positions(height, width, roi_height, roi_width, overlap):
    step_height = max(1, round(roi_height * (1 - overlap)))
    step_width = max(1, round(roi_width * (1 - overlap)))
    count_y = max(1, int(np.ceil((height - roi_height) / step_height)) + 1)
    count_x = max(1, int(np.ceil((width - roi_width) / step_width)) + 1)
    return sorted({
        (
            min(index_y * step_height, max(0, height - roi_height)),
            min(index_x * step_width, max(0, width - roi_width)),
        )
        for index_y in range(count_y)
        for index_x in range(count_x)
    })


def gaussian_weights(height, width):
    sigma = min(height, width) / 8
    center_y = (height - 1) / 2
    center_x = (width - 1) / 2
    y, x = np.mgrid[0:height, 0:width]
    return np.exp(-((y - center_y) ** 2 + (x - center_x) ** 2) / (2 * sigma ** 2)).astype(np.float32)


def segment_volume(volume, predictor, class_count, roi_size, overlap):
    roi_height, roi_width = roi_size
    weights = gaussian_weights(roi_height, roi_width)
    output = np.zeros(volume.shape, dtype=np.uint8)
    for slice_index in range(volume.shape[2]):
        source = volume[:, :, slice_index]
        if not source.any():
            continue
        height = max(source.shape[0], roi_height)
        width = max(source.shape[1], roi_width)
        padded = np.zeros((height, width), dtype=np.float32)
        padded[:source.shape[0], :source.shape[1]] = source
        accumulator = np.zeros((class_count, height, width), dtype=np.float32)
        weight_sum = np.zeros((height, width), dtype=np.float32)
        for tile_y, tile_x in tile_positions(height, width, roi_height, roi_width, overlap):
            patch = padded[tile_y:tile_y + roi_height, tile_x:tile_x + roi_width]
            logits = predictor(patch[np.newaxis, np.newaxis])[0]
            accumulator[:, tile_y:tile_y + roi_height, tile_x:tile_x + roi_width] += logits * weights
            weight_sum[tile_y:tile_y + roi_height, tile_x:tile_x + roi_width] += weights
        if not np.all(weight_sum > 0):
            raise ValueError(f"Sliding-window coverage gap in slice {slice_index}")
        labels = np.argmax(accumulator, axis=0).astype(np.uint8)
        output[:, :, slice_index] = labels[:source.shape[0], :source.shape[1]]
    return output


def dice(reference, candidate, label):
    reference_mask = reference == label
    candidate_mask = candidate == label
    denominator = int(reference_mask.sum() + candidate_mask.sum())
    return 1.0 if denominator == 0 else float(2 * np.logical_and(reference_mask, candidate_mask).sum() / denominator)


def parse_args():
    parser = argparse.ArgumentParser(description="Validate a converted MuscleMap model on MR and CT fixtures")
    parser.add_argument("--fixtures", type=Path, required=True)
    parser.add_argument("--release", type=Path, default=DEFAULT_RELEASE)
    parser.add_argument("--conversion-report", type=Path, default=DEFAULT_STAGE / "conversion-report.json")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--precision", choices=["fp32", "q8"], default="fp32")
    parser.add_argument("--report", type=Path, default=DEFAULT_STAGE / "fidelity-report.json")
    return parser.parse_args()


def main():
    args = parse_args()
    fixture_manifest = json.loads(args.fixtures.read_text())
    if fixture_manifest.get("schemaVersion") != 1:
        raise ValueError("Fixture manifest schemaVersion must be 1")
    cases = fixture_manifest.get("cases", [])
    if not isinstance(cases, list) or not cases:
        raise ValueError("Fixture manifest cases must be a non-empty array")
    case_ids = [case.get("id") for case in cases]
    if any(not isinstance(case_id, str) or not case_id for case_id in case_ids):
        raise ValueError("Every fixture requires a non-empty string id")
    if len(case_ids) != len(set(case_ids)):
        raise ValueError("Fixture ids must be unique")
    for case in cases:
        if str(case.get("modality", "")).lower() not in {"mr", "ct"}:
            raise ValueError(f"Fixture {case['id']} modality must be MR or CT")
        if not isinstance(case.get("image"), str):
            raise ValueError(f"Fixture {case['id']} requires an image path")
        if (
            not isinstance(case.get("sha256"), str) or len(case["sha256"]) != 64 or
            any(character not in "0123456789abcdef" for character in case["sha256"])
        ):
            raise ValueError(f"Fixture {case['id']} requires its expected SHA-256")
        if case.get("deidentified") is not True or case.get("approvedForLocalValidation") is not True:
            raise ValueError(f"Fixture {case['id']} must be deidentified and approved for local validation")
        if not isinstance(case.get("approvalReference"), str) or not case["approvalReference"]:
            raise ValueError(f"Fixture {case['id']} requires an approval reference")
    modalities = {str(case.get("modality", "")).lower() for case in cases}
    if not {"mr", "ct"}.issubset(modalities):
        raise ValueError("Fixture manifest must include at least one MR and one CT case")

    conversion_report = json.loads(args.conversion_report.read_text())
    candidate_record = next(
        (item for item in conversion_report["candidates"] if item["precision"] == args.precision),
        None,
    )
    if conversion_report.get("status") != "structural-and-random-patch-passed" or not candidate_record:
        raise ValueError("Conversion report does not authorize this candidate")
    candidate_path = args.conversion_report.parent / candidate_record["path"]
    convert_model.verify_file(candidate_path, candidate_record["bytes"], candidate_record["sha256"])

    _, release_model, config = convert_model.load_release(args.release, "wholebody", "1.4")
    convert_model.verify_file(
        args.checkpoint,
        release_model["source"]["checkpointBytes"],
        release_model["source"]["checkpointSha256"],
    )
    reference_model = convert_model.build_model(config, args.checkpoint)
    session = ort.InferenceSession(str(candidate_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    def predict_reference(batch):
        with torch.no_grad():
            return reference_model(torch.from_numpy(batch)).numpy()

    def predict_candidate(batch):
        return session.run(None, {input_name: batch})[0]

    case_reports = []
    covered_labels = set()
    all_matches = 0
    all_voxels = 0
    thresholds_passed = True
    class_count = config["model"]["out_channels"]
    roi_size = config["parameters"]["roi_size"]
    overlap = 0.9
    for case in cases:
        image_path = resolve_fixture_path(args.fixtures, case["image"])
        actual_fixture_sha256 = file_sha256(image_path)
        if actual_fixture_sha256 != case["sha256"]:
            raise ValueError(f"Fixture {case['id']} SHA-256 mismatch")
        volume = preprocess(image_path, config["parameters"]["pix_dim"], margin=20)
        reference = segment_volume(volume, predict_reference, class_count, roi_size, overlap)
        candidate = segment_volume(volume, predict_candidate, class_count, roi_size, overlap)
        present_labels = sorted(int(value) for value in np.unique(reference) if value > 0)
        covered_labels.update(present_labels)
        per_label_dice = {str(label): dice(reference, candidate, label) for label in present_labels}
        agreement = float(np.mean(reference == candidate))
        case_passed = agreement >= 0.99 and all(value >= 0.95 for value in per_label_dice.values())
        thresholds_passed = thresholds_passed and case_passed
        all_matches += int((reference == candidate).sum())
        all_voxels += reference.size
        case_reports.append({
            "id": case["id"],
            "modality": str(case["modality"]).upper(),
            "imageSha256": actual_fixture_sha256,
            "approvalReference": case["approvalReference"],
            "shapeAfterPreprocessing": list(volume.shape),
            "agreement": agreement,
            "perPresentLabelDice": per_label_dice,
            "presentLabels": present_labels,
            "passed": case_passed,
        })

    required_changed_labels = set(range(86, 114))
    missing_changed_labels = sorted(required_changed_labels - covered_labels)
    overall_agreement = all_matches / all_voxels
    passed = thresholds_passed and overall_agreement >= 0.99 and not missing_changed_labels
    report = {
        "schemaVersion": 1,
        "status": "passed" if passed else "failed",
        "candidate": {
            "precision": args.precision,
            "path": candidate_record["path"],
            "bytes": candidate_record["bytes"],
            "sha256": candidate_record["sha256"],
        },
        "gates": {
            "modalities": ["MR", "CT"],
            "overallAgreementAtLeast": 0.99,
            "perPresentLabelDiceAtLeast": 0.95,
            "requiredChangedClassIndices": [86, 113],
            "missingChangedClassIndices": missing_changed_labels,
        },
        "overallAgreement": overall_agreement,
        "cases": case_reports,
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Wrote {args.report}: {report['status']}")
    if not passed:
        raise ValueError("Fidelity gates failed; publication is prohibited")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

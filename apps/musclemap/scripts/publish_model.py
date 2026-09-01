#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download


SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
DEFAULT_STAGE = APP_DIR / ".tmp_model_release" / "wholebody-v1.4"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args():
    parser = argparse.ArgumentParser(description="Atomically publish a validated MuscleMap model")
    parser.add_argument("--repo", default="sbollmann/neurodesk-webapps-assets")
    parser.add_argument("--conversion-report", type=Path, default=DEFAULT_STAGE / "conversion-report.json")
    parser.add_argument("--fidelity-report", type=Path, default=DEFAULT_STAGE / "fidelity-report.json")
    parser.add_argument("--browser-report", type=Path, default=DEFAULT_STAGE / "browser-report.json")
    parser.add_argument("--upstream-report", type=Path, default=DEFAULT_STAGE / "upstream-parity-report.json")
    parser.add_argument("--receipt", type=Path, default=DEFAULT_STAGE / "publication-receipt.json")
    return parser.parse_args()


def verify_anonymous_download(repository, revision, candidate, local_directory):
    downloaded = Path(hf_hub_download(
        repo_id=repository,
        repo_type="dataset",
        filename="musclemap/musclemap-wholebody.onnx",
        revision=revision,
        token=False,
        local_dir=local_directory,
        force_download=True,
    ))
    if downloaded.stat().st_size != candidate["bytes"] or sha256(downloaded) != candidate["sha256"]:
        raise ValueError("Anonymous download verification failed after publication")


def main():
    args = parse_args()
    conversion = json.loads(args.conversion_report.read_text())
    fidelity = json.loads(args.fidelity_report.read_text())
    browser_report = json.loads(args.browser_report.read_text())
    upstream_report = json.loads(args.upstream_report.read_text())
    if conversion.get("status") != "structural-and-random-patch-passed":
        raise ValueError("Conversion report did not pass")
    if fidelity.get("status") != "passed":
        raise ValueError("Fidelity report did not pass")
    if browser_report.get("status") != "passed":
        raise ValueError("Browser report did not pass")
    if upstream_report.get("status") != "passed":
        raise ValueError("Full-volume upstream parity report did not pass")
    candidate = fidelity["candidate"]
    conversion_candidate = next(
        (item for item in conversion["candidates"] if item["precision"] == candidate["precision"]),
        None,
    )
    if not conversion_candidate or any(
        conversion_candidate[field] != candidate[field] for field in ("path", "bytes", "sha256")
    ):
        raise ValueError("Fidelity candidate does not match the conversion report")
    if browser_report.get("candidate") != candidate:
        raise ValueError("Browser report does not match the fidelity candidate")
    if upstream_report.get("candidate") != candidate:
        raise ValueError("Upstream parity report does not match the fidelity candidate")

    candidate_path = args.conversion_report.parent / candidate["path"]
    if candidate_path.stat().st_size != candidate["bytes"] or sha256(candidate_path) != candidate["sha256"]:
        raise ValueError("Candidate bytes do not match the validated reports")

    if args.receipt.exists():
        existing_receipt = json.loads(args.receipt.read_text())
        if (
            existing_receipt.get("status") == "published-and-anonymously-verified"
            and existing_receipt.get("repository") == args.repo
            and existing_receipt.get("candidate") == candidate
        ):
            with tempfile.TemporaryDirectory(prefix="musclemap-verify-") as temporary_directory:
                verify_anonymous_download(
                    args.repo,
                    existing_receipt["revision"],
                    candidate,
                    temporary_directory,
                )
            print(f"Existing publication remains verified at {existing_receipt['revision']}")
            return

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise ValueError("Set a rotated Hugging Face token in HF_TOKEN; tokens are never accepted as arguments")

    provenance = {
        "schemaVersion": 1,
        "modelId": conversion["model"]["id"],
        "modelVersion": conversion["model"]["version"],
        "labelSpaceId": conversion["model"]["labelSpaceId"],
        "source": conversion["source"],
        "candidate": candidate,
        "conversionReport": conversion,
        "fidelityReport": fidelity,
        "browserReport": browser_report,
        "upstreamParityReport": upstream_report,
    }

    with tempfile.TemporaryDirectory(prefix="musclemap-publish-") as temporary_directory:
        provenance_path = Path(temporary_directory) / "musclemap-wholebody-v1.4-provenance.json"
        provenance_path.write_text(json.dumps(provenance, indent=2) + "\n")
        api = HfApi(token=token)
        commit = api.create_commit(
            repo_id=args.repo,
            repo_type="dataset",
            commit_message="Publish validated MuscleMap whole-body v1.4 model",
            operations=[
                CommitOperationAdd(
                    path_in_repo="musclemap/musclemap-wholebody.onnx",
                    path_or_fileobj=str(candidate_path),
                ),
                CommitOperationAdd(
                    path_in_repo="musclemap/musclemap-wholebody-v1.4-provenance.json",
                    path_or_fileobj=str(provenance_path),
                ),
            ],
        )
        revision = commit.oid
        verify_anonymous_download(args.repo, revision, candidate, temporary_directory)

    receipt = {
        "schemaVersion": 1,
        "status": "published-and-anonymously-verified",
        "repository": args.repo,
        "revision": revision,
        "assetPath": "musclemap/musclemap-wholebody.onnx",
        "provenancePath": "musclemap/musclemap-wholebody-v1.4-provenance.json",
        "candidate": candidate,
    }
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"Published and verified immutable revision {revision}; wrote {args.receipt}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)

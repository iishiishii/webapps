#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np


def dice(reference, candidate, label=None):
    reference_mask = reference > 0 if label is None else reference == label
    candidate_mask = candidate > 0 if label is None else candidate == label
    denominator = int(reference_mask.sum() + candidate_mask.sum())
    if denominator == 0:
        return 1.0
    intersection = int(np.logical_and(reference_mask, candidate_mask).sum())
    return 2.0 * intersection / denominator


def main():
    parser = argparse.ArgumentParser(description="Compare a browser MuscleMap result with an upstream mask")
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--minimum-overall-agreement", type=float, default=0.99)
    parser.add_argument("--minimum-foreground-dice", type=float, default=0.95)
    parser.add_argument("--minimum-label-dice", type=float, default=0.95)
    args = parser.parse_args()

    reference_image = nib.load(args.reference)
    candidate_image = nib.load(args.candidate)
    reference = np.asarray(reference_image.dataobj)
    candidate = np.asarray(candidate_image.dataobj)
    shape_matches = reference.shape == candidate.shape
    affine_matches = np.array_equal(reference_image.affine, candidate_image.affine)
    if not shape_matches:
        raise ValueError(f"Shape mismatch: {reference.shape} != {candidate.shape}")

    labels = sorted(int(label) for label in np.union1d(reference, candidate) if label > 0)
    per_label = {}
    present_label_dice_passes = True
    for label in labels:
        reference_count = int(np.count_nonzero(reference == label))
        candidate_count = int(np.count_nonzero(candidate == label))
        label_dice = dice(reference, candidate, label)
        per_label[str(label)] = {
            "referenceVoxels": reference_count,
            "candidateVoxels": candidate_count,
            "dice": label_dice,
        }
        if reference_count > 0 and label_dice < args.minimum_label_dice:
            present_label_dice_passes = False

    overall_agreement = float(np.mean(reference == candidate))
    foreground_dice = dice(reference, candidate)
    report = {
        "schemaVersion": 1,
        "status": "passed" if (
            affine_matches
            and overall_agreement >= args.minimum_overall_agreement
            and foreground_dice >= args.minimum_foreground_dice
            and present_label_dice_passes
        ) else "failed",
        "reference": str(args.reference.resolve()),
        "candidate": str(args.candidate.resolve()),
        "shape": list(reference.shape),
        "shapeMatches": shape_matches,
        "affineMatchesExactly": affine_matches,
        "overallAgreement": overall_agreement,
        "foregroundDice": foreground_dice,
        "referenceForegroundVoxels": int(np.count_nonzero(reference)),
        "candidateForegroundVoxels": int(np.count_nonzero(candidate)),
        "perLabel": per_label,
        "thresholds": {
            "overallAgreement": args.minimum_overall_agreement,
            "foregroundDice": args.minimum_foreground_dice,
            "presentLabelDice": args.minimum_label_dice,
        },
    }
    rendered = json.dumps(report, indent=2) + "\n"
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered)
    print(rendered, end="")
    if report["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()

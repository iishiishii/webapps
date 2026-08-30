#!/usr/bin/env python3

import argparse
import json
import tempfile
from pathlib import Path

import nibabel as nib
import numpy as np
from monai.transforms import (
    Compose,
    CropForegroundd,
    EnsureChannelFirstd,
    EnsureTyped,
    LoadImaged,
    NormalizeIntensityd,
    Orientationd,
    SpatialPadd,
    Spacingd,
)


def main():
    parser = argparse.ArgumentParser(description="Emit the pinned upstream preprocessing result")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--chunk-start", type=int, default=0)
    parser.add_argument("--chunk-size", type=int, default=17)
    args = parser.parse_args()

    image = nib.load(args.input)
    end = min(image.shape[2], args.chunk_start + args.chunk_size)
    if args.chunk_start < 0 or args.chunk_start >= end:
        raise ValueError("Chunk range is empty")

    with tempfile.TemporaryDirectory(prefix="musclemap-monai-") as temp_dir:
        chunk_path = Path(temp_dir) / "chunk.nii"
        chunk = np.asarray(image.dataobj[..., args.chunk_start:end], dtype=np.float32)
        nib.save(nib.Nifti1Image(chunk, image.affine, image.header.copy()), chunk_path)
        transforms = Compose([
            LoadImaged(keys=["image"], image_only=False),
            EnsureChannelFirstd(keys=["image"]),
            Orientationd(keys=["image"], axcodes="RAS"),
            Spacingd(keys=["image"], pixdim=(1, 1, -1), mode="bilinear"),
            NormalizeIntensityd(keys=["image"], nonzero=True),
            CropForegroundd(keys=["image"], source_key="image", margin=20),
            SpatialPadd(keys=["image"], spatial_size=(256, 256, 1), method="end", mode="constant"),
            EnsureTyped(keys=["image"]),
        ])
        result = np.asarray(transforms({"image": str(chunk_path)})["image"][0], dtype=np.float32)

    args.output.write_bytes(result.ravel(order="F").tobytes())
    args.metadata.write_text(json.dumps({
        "chunk": [args.chunk_start, end],
        "shape": list(result.shape),
        "bytes": args.output.stat().st_size,
    }) + "\n")


if __name__ == "__main__":
    main()

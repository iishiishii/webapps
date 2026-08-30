#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import '../web/js/monai-compat.js';

function parseArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function parseNifti(bytes) {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const dims = [view.getInt16(42, true), view.getInt16(44, true), view.getInt16(46, true)];
  const datatype = view.getInt16(70, true);
  const start = Math.ceil(view.getFloat32(108, true));
  const slope = view.getFloat32(112, true) || 1;
  const intercept = view.getFloat32(116, true) || 0;
  const data = new Float32Array(dims[0] * dims[1] * dims[2]);
  const readers = {
    2: [1, (offset) => view.getUint8(offset)],
    4: [2, (offset) => view.getInt16(offset, true)],
    8: [4, (offset) => view.getInt32(offset, true)],
    16: [4, (offset) => view.getFloat32(offset, true)],
    64: [8, (offset) => view.getFloat64(offset, true)],
    512: [2, (offset) => view.getUint16(offset, true)]
  };
  const reader = readers[datatype];
  if (!reader) throw new Error(`Unsupported NIfTI datatype ${datatype}`);
  for (let index = 0; index < data.length; index++) data[index] = reader[1](start + index * reader[0]) * slope + intercept;
  const affine = Array.from({ length: 4 }, () => new Float64Array(4));
  for (let column = 0; column < 4; column++) {
    affine[0][column] = view.getFloat32(280 + column * 4, true);
    affine[1][column] = view.getFloat32(296 + column * 4, true);
    affine[2][column] = view.getFloat32(312 + column * 4, true);
  }
  affine[3].set([0, 0, 0, 1]);
  return { data, dims, affine };
}

function extractChunk(data, dims, start, size) {
  const plane = dims[0] * dims[1];
  const end = Math.min(dims[2], start + size);
  return {
    data: data.slice(start * plane, end * plane),
    dims: [dims[0], dims[1], end - start],
    end
  };
}

function normalizeNonzero(data) {
  let sum = 0;
  let count = 0;
  for (const value of data) if (value !== 0) { sum += value; count++; }
  const mean = sum / count;
  let squareSum = 0;
  for (const value of data) if (value !== 0) squareSum += (value - mean) ** 2;
  const deviation = Math.sqrt(squareSum / count) || 1;
  const output = new Float32Array(data.length);
  for (let index = 0; index < data.length; index++) if (data[index] !== 0) output[index] = (data[index] - mean) / deviation;
  return output;
}

function padEnd(data, dims, minimum) {
  const outputDims = dims.map((value, axis) => Math.max(value, minimum[axis]));
  const output = new Float32Array(outputDims[0] * outputDims[1] * outputDims[2]);
  for (let z = 0; z < dims[2]; z++) {
    for (let y = 0; y < dims[1]; y++) {
      const sourceOffset = z * dims[0] * dims[1] + y * dims[0];
      const targetOffset = z * outputDims[0] * outputDims[1] + y * outputDims[0];
      output.set(data.subarray(sourceOffset, sourceOffset + dims[0]), targetOffset);
    }
  }
  return { data: output, dims: outputDims };
}

async function main() {
  const input = resolve(parseArgument('--input', '/storage/github-repos/neurocontainers/build/musclemap-e2e/vhp-m-nifti/NECK_6.nii.gz'));
  const chunkStart = Number(parseArgument('--chunk-start', '0'));
  const chunkSize = Number(parseArgument('--chunk-size', '17'));
  const parsed = parseNifti(await readFile(input));
  const chunk = extractChunk(parsed.data, parsed.dims, chunkStart, chunkSize);
  const oriented = globalThis.MuscleMapMonaiCompat.orientToRAS(chunk.data, chunk.dims, parsed.affine);
  const resampled = globalThis.MuscleMapMonaiCompat.resampleVolume(oriented.data, oriented.dims, oriented.affine, [1, 1, -1]);
  const candidate = padEnd(normalizeNonzero(resampled.data), resampled.dims, [256, 256, 1]);

  const temporary = await mkdtemp(join(tmpdir(), 'musclemap-preprocess-'));
  try {
    const referencePath = join(temporary, 'reference.f32');
    const metadataPath = join(temporary, 'reference.json');
    const python = resolve('.tmp_model_env/bin/python');
    const emitted = spawnSync(python, [
      'scripts/emit_monai_preprocessing.py',
      '--input', input,
      '--output', referencePath,
      '--metadata', metadataPath,
      '--chunk-start', String(chunkStart),
      '--chunk-size', String(chunkSize)
    ], { cwd: resolve('.'), encoding: 'utf8' });
    if (emitted.status !== 0) throw new Error(emitted.stderr || emitted.stdout);
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const bytes = await readFile(referencePath);
    const reference = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    if (candidate.dims.some((value, axis) => value !== metadata.shape[axis])) {
      throw new Error(`Shape mismatch: browser=${candidate.dims.join('x')} MONAI=${metadata.shape.join('x')}`);
    }
    let absoluteDifference = 0;
    let maximumDifference = 0;
    let maximumDifferenceIndex = 0;
    let significantDifferenceCount = 0;
    for (let index = 0; index < reference.length; index++) {
      const difference = Math.abs(candidate.data[index] - reference[index]);
      absoluteDifference += difference;
      if (difference > 1e-3) significantDifferenceCount++;
      if (difference > maximumDifference) {
        maximumDifference = difference;
        maximumDifferenceIndex = index;
      }
    }
    const meanAbsoluteDifference = absoluteDifference / reference.length;
    const significantDifferenceFraction = significantDifferenceCount / reference.length;
    const report = {
      input,
      chunk: [chunkStart, chunk.end],
      shape: candidate.dims,
      meanAbsoluteDifference,
      maximumDifference,
      maximumDifferenceVoxel: [
        maximumDifferenceIndex % candidate.dims[0],
        Math.floor(maximumDifferenceIndex / candidate.dims[0]) % candidate.dims[1],
        Math.floor(maximumDifferenceIndex / (candidate.dims[0] * candidate.dims[1]))
      ],
      maximumDifferenceValues: [candidate.data[maximumDifferenceIndex], reference[maximumDifferenceIndex]],
      significantDifferenceCount,
      significantDifferenceFraction,
      thresholds: {
        meanAbsoluteDifferenceAtMost: 3e-5,
        differenceAbove1eMinus3FractionAtMost: 1e-4
      },
      passed: meanAbsoluteDifference <= 3e-5 && significantDifferenceFraction <= 1e-4
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();

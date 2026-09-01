import assert from 'node:assert/strict';
import test from 'node:test';

import '../web/js/asset-integrity.js';
import '../web/js/monai-compat.js';
import '../web/js/sliding-window-policy.js';

const { verifyAssetBuffer } = globalThis.MuscleMapAssetIntegrity;
const {
  computeGaussianWeightMap,
  computeTilePositions,
  computeAccumulatorBlocks,
  intersects,
  transposeNiftiSliceToModelOrder
} = globalThis.MuscleMapSlidingWindowPolicy;
const {
  computeSpacingGeometry,
  connectedComponents3D6,
  orientToRAS
} = globalThis.MuscleMapMonaiCompat;

test('model assets require exact byte length and SHA-256', async () => {
  const bytes = new TextEncoder().encode('verified model');
  const asset = {
    bytes: bytes.byteLength,
    sha256: '6c736b3dfa943bf4e7c61df78d1dfcad9a3d8b56369f0559670497b19127e74d'
  };
  assert.equal(await verifyAssetBuffer(bytes.buffer, asset), bytes.buffer);
  await assert.rejects(
    verifyAssetBuffer(new TextEncoder().encode('tampered model').buffer, asset),
    /bytes|SHA-256/
  );
});

test('bounded accumulation blocks cover every pixel exactly once', () => {
  const height = 913;
  const width = 1207;
  const classCount = 114;
  const maxElements = 2_000_000;
  const blocks = computeAccumulatorBlocks(height, width, classCount, maxElements);
  const coverage = new Uint8Array(height * width);
  for (const block of blocks) {
    assert.ok(block.width * block.height * classCount <= maxElements);
    for (let y = block.y; y < block.y + block.height; y++) {
      for (let x = block.x; x < block.x + block.width; x++) coverage[y * width + x]++;
    }
  }
  assert.ok(coverage.every(value => value === 1));
});

test('tile intersection includes boundary-spanning tiles only', () => {
  const block = { x: 256, y: 128, width: 256, height: 128 };
  assert.equal(intersects(block, { x: 500, y: 120, width: 32, height: 32 }), true);
  assert.equal(intersects(block, { x: 512, y: 128, width: 32, height: 32 }), false);
});

test('NIfTI slice memory order maps to model rows and columns', () => {
  const niftiOrder = Float32Array.of(0, 1, 2, 10, 11, 12);
  assert.deepEqual(
    [...transposeNiftiSliceToModelOrder(niftiOrder, 3, 2)],
    [0, 10, 1, 11, 2, 12]
  );
});

test('MONAI-compatible orientation and spacing reproduce the neck geometry', () => {
  const affine = [
    Float64Array.of(-1.17188, 0, 0, 150),
    Float64Array.of(0, 0, -4, 140),
    Float64Array.of(0, 1.17188, 0, -98.829407),
    Float64Array.of(0, 0, 0, 1)
  ];
  const oriented = orientToRAS(new Float32Array(256 * 63 * 256), [256, 256, 63], affine);
  assert.deepEqual(oriented.dims, [256, 63, 256]);
  const spacing = computeSpacingGeometry(oriented.dims, oriented.affine, [1, 1, -1]);
  assert.deepEqual(spacing.dims, [300, 249, 256]);
  assert.deepEqual(spacing.spacing.map(value => Number(value.toFixed(5))), [1, 1, 1.17188]);
});

test('MONAI-compatible spacing preserves an oblique affine rotation', () => {
  const angle = Math.PI / 6;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const affine = [
    Float64Array.of(2 * cosine, -3 * sine, 0, 10),
    Float64Array.of(2 * sine, 3 * cosine, 0, -20),
    Float64Array.of(0, 0, 4, 30),
    Float64Array.of(0, 0, 0, 1)
  ];
  const spacing = computeSpacingGeometry([10, 20, 30], affine, [1, 1, -1]);
  assert.deepEqual(spacing.dims, [19, 58, 30]);
  assert.ok(Math.abs(spacing.affine[0][0] - cosine) < 1e-12);
  assert.ok(Math.abs(spacing.affine[0][1] + sine) < 1e-12);
  assert.ok(Math.abs(spacing.affine[1][0] - sine) < 1e-12);
  assert.ok(Math.abs(spacing.affine[1][1] - cosine) < 1e-12);
  assert.deepEqual(spacing.affine.map(row => row[3]), [10, -20, 30, 1]);
});

test('upstream connectivity separates diagonal voxels', () => {
  assert.equal(connectedComponents3D6(Uint8Array.of(1, 0, 0, 1), [2, 2, 1]).numComponents, 2);
  assert.equal(connectedComponents3D6(Uint8Array.of(1, 1, 0, 0), [2, 2, 1]).numComponents, 1);
});

test('Gaussian blending and scan intervals match MONAI', () => {
  const weights = computeGaussianWeightMap(256, 256);
  assert.equal(weights[0], Math.fround(0.001));
  assert.ok(weights[127 * 256 + 127] > 0.999);
  assert.deepEqual(computeTilePositions(300, 300, 256, 256, 0.9), [
    { y: 0, x: 0 }, { y: 0, x: 25 }, { y: 0, x: 44 },
    { y: 25, x: 0 }, { y: 25, x: 25 }, { y: 25, x: 44 },
    { y: 44, x: 0 }, { y: 44, x: 25 }, { y: 44, x: 44 }
  ]);
});

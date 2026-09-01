import assert from 'node:assert/strict';
import test from 'node:test';

import '../web/js/label-codec.js';
import { getLabelSpace } from '../web/js/app/model-catalog.generated.js';

const { createLabelCodec, sameGeometry, toOpenReconInt12 } = globalThis.MuscleMapLabelCodec;

test('v1.4 sparse values round-trip through uint16', () => {
  const labelSpace = getLabelSpace('musclemap-wholebody-v1.4');
  const codec = createLabelCodec(labelSpace);
  const internal = Uint8Array.of(0, 1, 86, 98, 113);
  const external = codec.encode(internal);
  assert.ok(external instanceof Uint16Array);
  assert.deepEqual([...external], [0, 1101, 7231, 8151, 8222]);
  assert.deepEqual([...codec.decode(external, 'sparse')], [...internal]);
});

test('regional label spaces export uint8', () => {
  const labelSpace = getLabelSpace('musclemap-leg-v0.0');
  const codec = createLabelCodec(labelSpace);
  const external = codec.encode(Uint8Array.of(0, 1, 14));
  assert.ok(external instanceof Uint8Array);
  assert.deepEqual([...external], [0, 1, 14]);
});

test('unknown sparse values and class indices fail closed', () => {
  const codec = createLabelCodec(getLabelSpace('musclemap-wholebody-v1.4'));
  assert.throws(() => codec.decode(Uint16Array.of(8151, 9999), 'sparse'), /Unknown external label value 9999/);
  assert.throws(() => codec.decode(Uint16Array.of(114), 'class-index'), /Unknown class index 114/);
  assert.throws(() => codec.decode(Uint16Array.of(1), null), /Label encoding/);
});

test('auto-detects official sparse, class-index, and OpenRecon int12 labels', () => {
  const labelSpace = getLabelSpace('musclemap-wholebody-v1.4');
  const codec = createLabelCodec(labelSpace);
  const indexFor = (value) => labelSpace.labels.find(label => label.value === value).index;

  const sparse = codec.normalizeSegmentation(Uint16Array.of(0, 1101, 7132));
  assert.equal(sparse.resolution.kind, 'resolved');
  assert.equal(sparse.resolution.encoding, 'sparse');
  assert.deepEqual([...sparse.indices], [0, indexFor(1101), indexFor(7132)]);

  const classIndices = codec.normalizeSegmentation(Uint8Array.of(0, 1, 86));
  assert.equal(classIndices.resolution.encoding, 'class-index');
  assert.deepEqual([...classIndices.indices], [0, 1, 86]);

  const openRecon = codec.normalizeSegmentation(Uint16Array.of(0, 331, 2141));
  assert.equal(openRecon.resolution.encoding, 'openrecon-int12');
  assert.deepEqual([...openRecon.indices], [0, indexFor(1101), indexFor(7132)]);
  assert.match(openRecon.summary, /OpenRecon/);
});

test('restores every whole-body OpenRecon label to its release class index', () => {
  for (const labelSpaceId of ['musclemap-wholebody-v1.3', 'musclemap-wholebody-v1.4']) {
    const labelSpace = getLabelSpace(labelSpaceId);
    const codec = createLabelCodec(labelSpace);
    const mappedValues = Uint16Array.from(
      labelSpace.labels.map(label => toOpenReconInt12(label.value))
    );
    const normalized = codec.normalizeSegmentation(mappedValues, 'openrecon-int12');
    assert.deepEqual(
      [...normalized.indices],
      labelSpace.labels.map(label => label.index)
    );
  }
});

test('auto-detection compares anatomical meaning for overlapping values', () => {
  const labelSpace = getLabelSpace('musclemap-wholebody-v1.4');
  const codec = createLabelCodec(labelSpace);
  const indexFor = (value) => labelSpace.labels.find(label => label.value === value).index;

  const background = codec.normalizeSegmentation(Uint16Array.of(0, 0));
  assert.equal(background.resolution.kind, 'equivalent');
  assert.deepEqual([...background.indices], [0, 0]);
  assert.match(background.summary, /indeterminate/);

  assert.throws(
    () => codec.normalizeSegmentation(Uint16Array.of(0, 2141)),
    error => error.code === 'ambiguous-encoding' && /OpenRecon int12/.test(error.message)
  );

  assert.deepEqual(
    [...codec.normalizeSegmentation(Uint16Array.of(0, 2141), 'sparse').indices],
    [0, indexFor(2141)]
  );
  assert.deepEqual(
    [...codec.normalizeSegmentation(Uint16Array.of(0, 2141), 'openrecon-int12').indices],
    [0, indexFor(7132)]
  );
});

test('automatic import rejects invalid values and unsupported OpenRecon mappings', () => {
  const wholeBody = createLabelCodec(getLabelSpace('musclemap-wholebody-v1.4'));
  assert.equal(wholeBody.supportsEncoding('openrecon-int12'), true);
  assert.throws(
    () => wholeBody.normalizeSegmentation(Float32Array.of(0, 1101.5)),
    error => error.code === 'non-integer-label'
  );
  assert.throws(
    () => wholeBody.normalizeSegmentation(Uint16Array.of(0, 9999)),
    error => error.code === 'unknown-label' && /9999/.test(error.message)
  );

  const regional = createLabelCodec(getLabelSpace('musclemap-leg-v0.0'));
  assert.equal(regional.supportsEncoding('openrecon-int12'), false);
  assert.throws(
    () => regional.normalizeSegmentation(Uint8Array.of(0, 1), 'openrecon-int12'),
    error => error.code === 'unsupported-encoding'
  );
});

test('geometry comparison includes dimensions and affine', () => {
  const geometry = {
    dims: [10, 20, 30],
    affine: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
  };
  assert.equal(sameGeometry(geometry, structuredClone(geometry)), true);
  const shifted = structuredClone(geometry);
  shifted.affine[0][3] = 1;
  assert.equal(sameGeometry(geometry, shifted), false);
});

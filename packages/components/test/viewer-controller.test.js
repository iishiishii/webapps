import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewerController } from '../src/viewer/ViewerController.js';

function file(name) {
  const value = new Blob([new Uint8Array([0])]);
  Object.defineProperty(value, 'name', { value: name });
  return value;
}

function niivue({ failBase = false, failOverlay = false } = {}) {
  return {
    volumes: [],
    async loadVolumes(entries) {
      if (failBase) throw new Error('base failed');
      this.volumes = entries.map(entry => ({ name: entry.name, img: new Uint8Array([0, 1]) }));
    },
    async addVolumeFromUrl(entry) {
      if (failOverlay) throw new Error('overlay failed');
      this.volumes.push({ name: entry.name, img: new Uint8Array([0, 1]) });
    },
    setOpacity(index, opacity) {
      this.volumes[index].opacity = opacity;
    },
    updateGLVolume() {},
    drawScene() {},
  };
}

test('loadVolumeStack reports a failed base load and clears partial state', async () => {
  const nv = niivue({ failBase: true });
  const viewer = new ViewerController({ nv });

  assert.equal(await viewer.loadVolumeStack([{ file: file('base.nii'), stage: 'input' }]), false);
  assert.deepEqual(nv.volumes, []);
  assert.equal(viewer.currentVolumeStackSignature, null);
});

test('loadVolumeStack reports a failed overlay load and clears the loaded base', async () => {
  const nv = niivue({ failOverlay: true });
  const viewer = new ViewerController({ nv });

  assert.equal(await viewer.loadVolumeStack([
    { file: file('base.nii'), stage: 'input' },
    { file: file('seg.nii'), stage: 'segmentation' },
  ]), false);
  assert.deepEqual(nv.volumes, []);
  assert.equal(viewer.currentVolumeStackSignature, null);
});

test('clearing volumes revokes stable object URLs and releases file references', async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  URL.createObjectURL = input => `blob:${input.name}`;
  URL.revokeObjectURL = url => revoked.push(url);

  try {
    const viewer = new ViewerController({ nv: niivue() });
    const base = file('base.nii');
    const seg = file('seg.nii');
    await viewer.loadVolumeStack([
      { file: base, stage: 'input' },
      { file: seg, stage: 'segmentation' },
    ]);

    assert.equal(viewer.objectUrls.size, 2);
    viewer.clearVolumes();
    assert.deepEqual(new Set(revoked), new Set(['blob:base.nii', 'blob:seg.nii']));
    assert.equal(viewer.objectUrls.size, 0);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test('a stage removed from a stack is visible when explicitly added again', async () => {
  const nv = niivue();
  const viewer = new ViewerController({ nv });
  const base = file('base.nii');
  const seg = file('seg.nii');

  await viewer.loadVolumeStack([
    { file: base, stage: 'input' },
    { file: seg, stage: 'segmentation', opacity: 0.5 },
  ]);
  viewer.setStageVisible('segmentation', false);
  await viewer.loadVolumeStack([{ file: base, stage: 'input' }]);
  await viewer.loadVolumeStack([
    { file: base, stage: 'input' },
    { file: seg, stage: 'segmentation', opacity: 0.5 },
  ]);

  assert.equal(viewer.isStageVisible('segmentation'), true);
  assert.equal(nv.volumes[1].opacity, 0.5);
});

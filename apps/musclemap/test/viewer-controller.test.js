import assert from 'node:assert/strict';
import test from 'node:test';

import { MuscleMapViewer } from '../web/js/controllers/MuscleMapViewer.js';

test('maps class-index segmentation values to the same 8-bit colormap entries', () => {
  const segmentation = {
    id: 'segmentation',
    img: new Uint8Array([0, 100])
  };
  const nv = {
    volumes: [{}, segmentation],
    setColormap() {}
  };
  const viewer = new MuscleMapViewer({ nv });

  viewer.configureSegmentationVolume(1, 'musclemap');

  assert.equal(segmentation.cal_min, 0);
  assert.equal(segmentation.cal_max, 255);
  const lutIndex = Math.round(
    255 * (100 - segmentation.cal_min) / (segmentation.cal_max - segmentation.cal_min)
  );
  assert.equal(lutIndex, 100);
  assert.equal(segmentation.colormap, 'musclemap');
  assert.equal(segmentation.interpolation, false);
});

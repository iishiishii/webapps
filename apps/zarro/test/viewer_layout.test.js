import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MULTIPLANAR_TYPE,
  SHOW_RENDER,
  SLICE_TYPE,
} from '@niivue/niivue'
import {
  DEFAULT_LAYOUT_ID,
  LAYOUT_PRESET,
  viewerLayoutConfig,
} from '../src/viewer_layout.ts'

test('NVSlide axial focus is the startup layout', () => {
  assert.equal(DEFAULT_LAYOUT_ID, LAYOUT_PRESET.NVSLIDE_AXIAL_FOCUS)
})

test('equal slices uses three horizontal thirds without a render tile', () => {
  const layout = viewerLayoutConfig(LAYOUT_PRESET.EQUAL_SLICES)

  assert.equal(layout.kind, 'niivue')
  assert.equal(layout.niivue.sliceType, SLICE_TYPE.MULTIPLANAR)
  assert.equal(layout.niivue.showRender, SHOW_RENDER.NEVER)
  assert.equal(layout.niivue.multiplanarType, MULTIPLANAR_TYPE.ROW)
  assert.equal(layout.niivue.isEqualSize, true)
  assert.equal(layout.niivue.customLayout, null)
})

test('vertical equal slices use equal physical fields of view', () => {
  const extents = [108.64, 67.31, 5.25]
  const layout = viewerLayoutConfig(
    LAYOUT_PRESET.EQUAL_SLICES_VERTICAL,
    extents,
  )

  assert.equal(layout.niivue.sliceType, SLICE_TYPE.MULTIPLANAR)
  assert.equal(layout.niivue.showRender, SHOW_RENDER.NEVER)
  assert.equal(layout.niivue.multiplanarType, MULTIPLANAR_TYPE.COLUMN)
  assert.equal(layout.niivue.isEqualSize, false)
  assert.deepEqual(
    layout.niivue.customLayout.map(({ sliceType, position }) => ({
      sliceType,
      position,
    })),
    [
      { sliceType: SLICE_TYPE.AXIAL, position: [0, 0, 1, 1 / 3] },
      { sliceType: SLICE_TYPE.CORONAL, position: [0, 1 / 3, 1, 1 / 3] },
      { sliceType: SLICE_TYPE.SAGITTAL, position: [0, 2 / 3, 1, 1 / 3] },
    ],
  )

  const fieldsOfView = [
    Math.min(extents[0], extents[1]) *
      layout.niivue.customLayout[0].squareCropFraction,
    Math.min(extents[0], extents[2]) *
      layout.niivue.customLayout[1].squareCropFraction,
    Math.min(extents[1], extents[2]) *
      layout.niivue.customLayout[2].squareCropFraction,
  ]
  assert.deepEqual(
    fieldsOfView.map((fieldOfView) => fieldOfView.toFixed(6)),
    ['67.310000', '67.310000', '67.310000'],
  )
})

test('NVSlide axial focus is a renderer layout with a valid NiiVue standby', () => {
  const layout = viewerLayoutConfig(LAYOUT_PRESET.NVSLIDE_AXIAL_FOCUS)

  assert.equal(layout.kind, 'nvslide')
  assert.equal(layout.arrangement, 'axial-focus')
  assert.equal(layout.niivue.sliceType, SLICE_TYPE.AXIAL)
  assert.equal(layout.niivue.showRender, SHOW_RENDER.NEVER)
})

test('unknown layouts cannot become NiiVue slice types', () => {
  const layout = viewerLayoutConfig(999)

  assert.equal(layout.kind, 'niivue')
  assert.equal(layout.niivue.sliceType, SLICE_TYPE.MULTIPLANAR)
})

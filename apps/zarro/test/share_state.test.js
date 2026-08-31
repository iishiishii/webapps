import assert from 'node:assert/strict'
import test from 'node:test'
import { readShareState, writeShareState } from '../src/share_state.ts'

const state = {
  layout: 31,
  azimuth: 120.5,
  elevation: 22,
  scale: 1.75,
  crosshair: [0.2, 0.4, 0.6],
  pan2D: [1.25, -2.5, 3.75, 2],
  renderPan: [0.1, -0.2],
  colormap: 'viridis',
  windowLevel: 500,
  windowWidth: 900,
  scrollZoomSpeed: 5,
  detailBudgetGiB: 8,
  showCrosshair: false,
  showScaleBar: true,
  showStats: true,
  nvSlideNavigation: {
    version: 1,
    activePlane: 'coronal',
    framings: {
      axial: { centerU: 0.22, centerV: 0.71, zoomOverFit: 6 },
      sagittal: { centerU: 0.4, centerV: 0.3, zoomOverFit: 2.5 },
      coronal: { centerU: 0.61, centerV: 0.39, zoomOverFit: 3.2 },
    },
  },
}

test('round-trips viewer settings through a share URL', () => {
  const url = writeShareState(
    new URL('https://webapps.neurodesk.org/zarro/?url=https://example.test/a'),
    state,
  )
  assert.equal(url.searchParams.get('url'), 'https://example.test/a')
  assert.equal(url.searchParams.get('scrollZoomSpeed'), '5')
  assert.equal(url.searchParams.get('detailBudget'), '8')
  assert.equal(url.searchParams.get('layout'), '31')
  assert.equal(
    url.searchParams.get('nvslide'),
    JSON.stringify(state.nvSlideNavigation),
  )
  assert.equal(url.searchParams.has('equalViews'), false)
  assert.deepEqual(readShareState(url.searchParams, state), state)
})

test('restores old links without NVSlide navigation state', () => {
  const defaults = { ...state, nvSlideNavigation: null }
  const restored = readShareState(new URLSearchParams('layout=34'), defaults)

  assert.equal(restored.nvSlideNavigation, null)
})

test('ignores malformed and unsupported NVSlide navigation state', () => {
  const defaults = { ...state, nvSlideNavigation: null }
  const malformed = [
    '{',
    JSON.stringify({ ...state.nvSlideNavigation, version: 2 }),
    JSON.stringify({
      ...state.nvSlideNavigation,
      framings: {
        ...state.nvSlideNavigation.framings,
        axial: { centerU: 0.2, centerV: 0.4, zoomOverFit: 0 },
      },
    }),
    JSON.stringify({
      version: 1,
      activePlane: 'axial',
      framings: { axial: state.nvSlideNavigation.framings.axial },
    }),
  ]

  for (const nvslide of malformed) {
    const params = new URLSearchParams({ layout: '34', nvslide })
    assert.equal(readShareState(params, defaults).nvSlideNavigation, null)
  }
})

test('ignores invalid shared camera and detail budget values', () => {
  const params = new URLSearchParams('layout=99&zoom=nope&pan=1,2&detailBudget=99')
  assert.deepEqual(readShareState(params, state), {
    ...state,
    nvSlideNavigation: null,
  })
})

test('maps legacy multiplanar links onto the new layout presets', () => {
  assert.equal(
    readShareState(new URLSearchParams('layout=3&equalViews=0'), state).layout,
    30,
  )
  assert.equal(
    readShareState(new URLSearchParams('layout=3&equalViews=1'), state).layout,
    31,
  )
})

test('restores the vertical equal-slices preset', () => {
  assert.equal(readShareState(new URLSearchParams('layout=33'), state).layout, 33)
})

test('restores the permanent NVSlide layout', () => {
  assert.equal(readShareState(new URLSearchParams('layout=34'), state).layout, 34)
})

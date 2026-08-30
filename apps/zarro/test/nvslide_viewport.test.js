import assert from 'node:assert/strict'
import test from 'node:test'
import {
  captureNvSlideFraming,
  projectNvSlideFraming,
} from '../src/nvslide_viewport.ts'

test('round-trips an NVSlide viewport through source-independent framing', () => {
  const space = { manifestWidth: 800, manifestHeight: 400, fitScale: 0.5 }
  const viewport = { centerX: 176, centerY: 284, scale: 3 }

  const framing = captureNvSlideFraming(viewport, space)

  assert.deepEqual(framing, {
    centerU: 0.22,
    centerV: 0.71,
    zoomOverFit: 6,
  })
  assert.deepEqual(projectNvSlideFraming(framing, space), viewport)
})

test('projects framing into a differently sized and fitted stain', () => {
  const framing = captureNvSlideFraming(
    { centerX: 250, centerY: 180, scale: 2 },
    { manifestWidth: 1000, manifestHeight: 600, fitScale: 0.25 },
  )

  assert.deepEqual(
    projectNvSlideFraming(framing, {
      manifestWidth: 2400,
      manifestHeight: 900,
      fitScale: 0.1,
    }),
    { centerX: 600, centerY: 270, scale: 0.8 },
  )
})

test('preserves legal overscroll instead of clipping it in the conversion', () => {
  const framing = captureNvSlideFraming(
    { centerX: -40, centerY: 540, scale: 1.5 },
    { manifestWidth: 400, manifestHeight: 500, fitScale: 0.5 },
  )

  assert.deepEqual(framing, {
    centerU: -0.1,
    centerV: 1.08,
    zoomOverFit: 3,
  })
  const projected = projectNvSlideFraming(framing, {
    manifestWidth: 800,
    manifestHeight: 250,
    fitScale: 0.2,
  })
  assert.ok(projected)
  assert.equal(projected.centerX, -80)
  assert.equal(projected.centerY, 270)
  assert.ok(Math.abs(projected.scale - 0.6) < 1e-12)
})

test('rejects invalid native and retained framing values', () => {
  assert.equal(
    captureNvSlideFraming(
      { centerX: 1, centerY: 1, scale: 1 },
      { manifestWidth: 0, manifestHeight: 10, fitScale: 1 },
    ),
    null,
  )
  assert.equal(
    projectNvSlideFraming(
      { centerU: 0.5, centerV: Number.NaN, zoomOverFit: 1 },
      { manifestWidth: 10, manifestHeight: 10, fitScale: 1 },
    ),
    null,
  )
})

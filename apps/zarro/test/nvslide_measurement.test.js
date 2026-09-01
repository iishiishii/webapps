import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatMeasuredDistance,
  measurementFromSlidePoints,
  measurementIndexAtSlidePoint,
  measurementSegmentOnPlane,
  slidePointToMeasurementMM,
} from '../src/nvslide_measurement.ts'

const axial = {
  plane: 'axial',
  shape: [100, 80, 20],
  spacing: [0.01, 0.02, 0.5],
  normalIndex: 7,
  manifestWidth: 100,
  manifestHeight: 160,
}

test('maps NVSlide points into world millimetres', () => {
  assert.deepEqual(
    slidePointToMeasurementMM({ x: 25, y: 40 }, axial),
    [0.25, 0.4, 3.5],
  )
  const measurement = measurementFromSlidePoints(
    { x: 25, y: 40 },
    { x: 75, y: 120 },
    axial,
  )
  assert.deepEqual(measurement.startMM, [0.25, 0.4, 3.5])
  assert.deepEqual(measurement.endMM, [0.75, 1.2, 3.5])
  assert.ok(Math.abs(measurement.distance - Math.hypot(0.5, 0.8)) < 1e-12)
})

test('projects only measurements on the displayed plane', () => {
  const visible = {
    startMM: [0.2, 0.4, 3.5],
    endMM: [0.8, 1.2, 3.5],
    distance: 1,
  }
  const hidden = {
    ...visible,
    startMM: [0.2, 0.4, 4],
    endMM: [0.8, 1.2, 4],
  }

  const segment = measurementSegmentOnPlane(visible, axial)
  assert.ok(segment)
  assert.ok(Math.abs(segment.start.x - 20) < 1e-12)
  assert.ok(Math.abs(segment.start.y - 40) < 1e-12)
  assert.ok(Math.abs(segment.end.x - 80) < 1e-12)
  assert.ok(Math.abs(segment.end.y - 120) < 1e-12)
  assert.equal(measurementSegmentOnPlane(hidden, axial), null)
})

test('finds the nearest visible NVSlide measurement', () => {
  const measurements = [
    {
      startMM: [0.2, 0.4, 3.5],
      endMM: [0.8, 1.2, 3.5],
      distance: 1,
    },
    {
      startMM: [0.1, 0.1, 4],
      endMM: [0.9, 0.1, 4],
      distance: 0.8,
    },
  ]

  assert.equal(
    measurementIndexAtSlidePoint(measurements, axial, { x: 50, y: 82 }, 5),
    0,
  )
  assert.equal(
    measurementIndexAtSlidePoint(measurements, axial, { x: 50, y: 100 }, 5),
    -1,
  )
})

test('formats submillimetre and millimetre distances', () => {
  assert.equal(formatMeasuredDistance(0.025), '25 µm')
  assert.equal(formatMeasuredDistance(2.345), '2.35 mm')
})

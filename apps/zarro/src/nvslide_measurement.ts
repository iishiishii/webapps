import {
  PLANE_DEFINITIONS,
  type Shape3,
  type VolumePlane,
} from './volume_plane_source.ts'

export interface NvSlidePoint {
  x: number
  y: number
}

export interface NvSlideMeasurement {
  startMM: readonly [number, number, number]
  endMM: readonly [number, number, number]
  distance: number
}

export interface NvSlideMeasurementGeometry {
  plane: VolumePlane
  shape: Shape3
  spacing: Shape3
  normalIndex: number
  manifestWidth: number
  manifestHeight: number
}

export interface NvSlideMeasurementSegment {
  start: NvSlidePoint
  end: NvSlidePoint
}

const clampedFraction = (coordinate: number, extent: number): number => {
  if (!Number.isFinite(coordinate) || !Number.isFinite(extent) || extent <= 0) {
    return 0
  }
  return Math.min(1, Math.max(0, coordinate / extent))
}

const mmToSlide = (
  coordinateMM: number,
  voxelCount: number,
  spacing: number,
  manifestExtent: number,
): number => {
  const physicalExtent = voxelCount * spacing
  if (
    !Number.isFinite(coordinateMM) ||
    !Number.isFinite(physicalExtent) ||
    physicalExtent <= 0
  ) {
    return 0
  }
  return (coordinateMM / physicalExtent) * manifestExtent
}

const distanceToSegment = (
  point: NvSlidePoint,
  segment: NvSlideMeasurementSegment,
): number => {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return Math.hypot(point.x - segment.start.x, point.y - segment.start.y)
  }
  const projection = Math.min(
    1,
    Math.max(
      0,
      ((point.x - segment.start.x) * dx +
        (point.y - segment.start.y) * dy) /
        lengthSquared,
    ),
  )
  return Math.hypot(
    point.x - (segment.start.x + projection * dx),
    point.y - (segment.start.y + projection * dy),
  )
}

export function slidePointToMeasurementMM(
  point: NvSlidePoint,
  geometry: NvSlideMeasurementGeometry,
): Shape3 {
  const definition = PLANE_DEFINITIONS[geometry.plane]
  const pointMM: Shape3 = [0, 0, 0]
  const uFraction = clampedFraction(point.x, geometry.manifestWidth)
  const vFraction = clampedFraction(point.y, geometry.manifestHeight)
  pointMM[definition.uAxis] =
    uFraction * geometry.shape[definition.uAxis] * geometry.spacing[definition.uAxis]
  pointMM[definition.vAxis] =
    vFraction * geometry.shape[definition.vAxis] * geometry.spacing[definition.vAxis]
  pointMM[definition.normalAxis] =
    geometry.normalIndex * geometry.spacing[definition.normalAxis]
  return pointMM
}

export function measurementFromSlidePoints(
  start: NvSlidePoint,
  end: NvSlidePoint,
  geometry: NvSlideMeasurementGeometry,
): NvSlideMeasurement {
  const startMM = slidePointToMeasurementMM(start, geometry)
  const endMM = slidePointToMeasurementMM(end, geometry)
  return {
    startMM,
    endMM,
    distance: Math.hypot(
      endMM[0] - startMM[0],
      endMM[1] - startMM[1],
      endMM[2] - startMM[2],
    ),
  }
}

export function measurementSegmentOnPlane(
  measurement: NvSlideMeasurement,
  geometry: NvSlideMeasurementGeometry,
): NvSlideMeasurementSegment | null {
  const definition = PLANE_DEFINITIONS[geometry.plane]
  const normalAxis = definition.normalAxis
  const planeMM = geometry.normalIndex * geometry.spacing[normalAxis]
  const tolerance = geometry.spacing[normalAxis] * 0.5 + Number.EPSILON
  if (
    Math.abs(measurement.startMM[normalAxis] - planeMM) > tolerance ||
    Math.abs(measurement.endMM[normalAxis] - planeMM) > tolerance
  ) {
    return null
  }
  return {
    start: {
      x: mmToSlide(
        measurement.startMM[definition.uAxis],
        geometry.shape[definition.uAxis],
        geometry.spacing[definition.uAxis],
        geometry.manifestWidth,
      ),
      y: mmToSlide(
        measurement.startMM[definition.vAxis],
        geometry.shape[definition.vAxis],
        geometry.spacing[definition.vAxis],
        geometry.manifestHeight,
      ),
    },
    end: {
      x: mmToSlide(
        measurement.endMM[definition.uAxis],
        geometry.shape[definition.uAxis],
        geometry.spacing[definition.uAxis],
        geometry.manifestWidth,
      ),
      y: mmToSlide(
        measurement.endMM[definition.vAxis],
        geometry.shape[definition.vAxis],
        geometry.spacing[definition.vAxis],
        geometry.manifestHeight,
      ),
    },
  }
}

export function measurementIndexAtSlidePoint(
  measurements: readonly NvSlideMeasurement[],
  geometry: NvSlideMeasurementGeometry,
  point: NvSlidePoint,
  hitRadius: number,
): number {
  let closestIndex = -1
  let closestDistance = hitRadius
  for (const [index, measurement] of measurements.entries()) {
    const segment = measurementSegmentOnPlane(measurement, geometry)
    if (!segment) continue
    const distance = distanceToSegment(point, segment)
    if (distance <= closestDistance) {
      closestDistance = distance
      closestIndex = index
    }
  }
  return closestIndex
}

export function formatMeasuredDistance(distanceMM: number): string {
  if (distanceMM < 1) {
    const micrometres = distanceMM * 1000
    return `${micrometres.toFixed(micrometres < 10 ? 1 : 0)} µm`
  }
  return `${distanceMM.toFixed(distanceMM < 10 ? 2 : 1)} mm`
}

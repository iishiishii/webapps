import type { NVSlideViewport } from '@niivue/niivue'

export interface NvSlideFraming {
  readonly centerU: number
  readonly centerV: number
  readonly zoomOverFit: number
}

export interface NvSlideFramingSpace {
  readonly manifestWidth: number
  readonly manifestHeight: number
  readonly fitScale: number
}

const isFinitePositive = (value: number): boolean =>
  Number.isFinite(value) && value > 0

const isValidSpace = (space: NvSlideFramingSpace): boolean =>
  isFinitePositive(space.manifestWidth) &&
  isFinitePositive(space.manifestHeight) &&
  isFinitePositive(space.fitScale)

export function captureNvSlideFraming(
  viewport: Readonly<NVSlideViewport>,
  space: NvSlideFramingSpace,
): NvSlideFraming | null {
  if (
    !isValidSpace(space) ||
    !Number.isFinite(viewport.centerX) ||
    !Number.isFinite(viewport.centerY) ||
    !isFinitePositive(viewport.scale)
  ) {
    return null
  }
  return {
    centerU: viewport.centerX / space.manifestWidth,
    centerV: viewport.centerY / space.manifestHeight,
    zoomOverFit: viewport.scale / space.fitScale,
  }
}

export function projectNvSlideFraming(
  framing: NvSlideFraming,
  space: NvSlideFramingSpace,
): NVSlideViewport | null {
  if (
    !isValidSpace(space) ||
    !Number.isFinite(framing.centerU) ||
    !Number.isFinite(framing.centerV) ||
    !isFinitePositive(framing.zoomOverFit)
  ) {
    return null
  }
  return {
    centerX: framing.centerU * space.manifestWidth,
    centerY: framing.centerV * space.manifestHeight,
    scale: framing.zoomOverFit * space.fitScale,
  }
}

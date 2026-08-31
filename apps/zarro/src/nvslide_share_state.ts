import type { NvSlideFraming } from './nvslide_viewport.ts'
import type { VolumePlane } from './volume_plane_source.ts'

const VOLUME_PLANES = ['axial', 'sagittal', 'coronal'] as const

export interface NvSlideShareSnapshotV1 {
  readonly version: 1
  readonly activePlane: VolumePlane
  readonly framings: Readonly<Record<VolumePlane, NvSlideFraming>>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isVolumePlane = (value: unknown): value is VolumePlane =>
  typeof value === 'string' && VOLUME_PLANES.some((plane) => plane === value)

const parseFraming = (value: unknown): NvSlideFraming | null => {
  if (!isRecord(value)) return null
  const { centerU, centerV, zoomOverFit } = value
  if (
    typeof centerU !== 'number' ||
    !Number.isFinite(centerU) ||
    typeof centerV !== 'number' ||
    !Number.isFinite(centerV) ||
    typeof zoomOverFit !== 'number' ||
    !Number.isFinite(zoomOverFit) ||
    zoomOverFit <= 0
  ) {
    return null
  }
  return { centerU, centerV, zoomOverFit }
}

export function parseNvSlideShareSnapshot(
  value: string | null,
): NvSlideShareSnapshotV1 | null {
  if (!value) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !isVolumePlane(parsed.activePlane)) {
    return null
  }
  if (!isRecord(parsed.framings)) return null
  const axial = parseFraming(parsed.framings.axial)
  const sagittal = parseFraming(parsed.framings.sagittal)
  const coronal = parseFraming(parsed.framings.coronal)
  if (!axial || !sagittal || !coronal) return null
  return {
    version: 1,
    activePlane: parsed.activePlane,
    framings: { axial, sagittal, coronal },
  }
}

export function stringifyNvSlideShareSnapshot(
  snapshot: NvSlideShareSnapshotV1,
): string {
  return JSON.stringify(snapshot)
}

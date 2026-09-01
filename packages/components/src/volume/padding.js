import { assertDims, voxelCount } from './geometry.js';

export function padVolumeCentered(data, sourceDims, targetDims, OutputCtor = data.constructor) {
  assertDims(sourceDims);
  assertDims(targetDims);
  if (sourceDims.some((size, axis) => size > targetDims[axis])) {
    throw new Error('targetDims must contain sourceDims');
  }

  const [sx, sy, sz] = sourceDims;
  const [tx, ty] = targetDims;
  const offsets = sourceDims.map((size, axis) => Math.floor((targetDims[axis] - size) / 2));
  const [ox, oy, oz] = offsets;
  const result = new OutputCtor(voxelCount(targetDims));
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      const sourceOffset = z * sy * sx + y * sx;
      const targetOffset = (z + oz) * ty * tx + (y + oy) * tx + ox;
      result.set(data.subarray(sourceOffset, sourceOffset + sx), targetOffset);
    }
  }
  return result;
}

export function cropCenteredVolume(data, sourceDims, targetDims, OutputCtor = data.constructor) {
  assertDims(sourceDims);
  assertDims(targetDims);
  if (targetDims.some((size, axis) => size > sourceDims[axis])) {
    throw new Error('targetDims must fit inside sourceDims');
  }

  const [sx, sy] = sourceDims;
  const [tx, ty, tz] = targetDims;
  const offsets = targetDims.map((size, axis) => Math.floor((sourceDims[axis] - size) / 2));
  const [ox, oy, oz] = offsets;
  const result = new OutputCtor(voxelCount(targetDims));
  for (let z = 0; z < tz; z++) {
    for (let y = 0; y < ty; y++) {
      const sourceOffset = (z + oz) * sy * sx + (y + oy) * sx + ox;
      const targetOffset = z * ty * tx + y * tx;
      result.set(data.subarray(sourceOffset, sourceOffset + tx), targetOffset);
    }
  }
  return result;
}

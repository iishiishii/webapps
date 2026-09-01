import { getOrientationTransform, orientToRAS } from '../volume/geometry.js';

function copyHeader(headerBytes) {
  if (!(headerBytes instanceof ArrayBuffer)) throw new TypeError('NIfTI headerBytes must be an ArrayBuffer');
  return headerBytes.slice(0);
}

/**
 * Preserve a parsed volume's native geometry and prepare an independently
 * owned RAS-oriented header/data view for inference workers.
 */
export function prepareRasWorkerInput(parsed) {
  const { imageData, dims, voxelSize, affine } = parsed;
  if (!ArrayBuffer.isView(imageData)) throw new TypeError('NIfTI imageData must be a typed array');
  if (dims?.length !== 3 || voxelSize?.length !== 3 || affine?.length < 3) {
    throw new TypeError('NIfTI input must contain 3D dimensions, spacing, and an affine');
  }

  const origHeaderBytes = copyHeader(parsed.headerBytes);
  const headerBytes = copyHeader(parsed.headerBytes);
  const { perm, flip } = getOrientationTransform(affine);
  const isIdentity = perm.every((axis, index) => axis === index && !flip[index]);
  const oriented = isIdentity ? { data: imageData, dims: [...dims] } : orientToRAS(imageData, dims, perm, flip);
  const rasSpacing = perm.map((axis) => voxelSize[axis]);

  if (!isIdentity) {
    const srcVoxel = [0, 0, 0];
    for (let index = 0; index < 3; index += 1) {
      srcVoxel[perm[index]] = flip[index] ? oriented.dims[index] - 1 : 0;
    }
    const origin = [0, 1, 2].map((row) => (
      affine[row][0] * srcVoxel[0]
      + affine[row][1] * srcVoxel[1]
      + affine[row][2] * srcVoxel[2]
      + affine[row][3]
    ));
    const header = new DataView(headerBytes);
    header.setInt16(254, 1, true);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        header.setFloat32(280 + row * 16 + column * 4, row === column ? rasSpacing[row] : 0, true);
      }
      header.setFloat32(292 + row * 16, origin[row], true);
    }
    header.setInt16(252, 0, true);
  }

  return Object.freeze({
    origDims: [...dims],
    affine,
    headerBytes,
    origHeaderBytes,
    perm,
    flip,
    isIdentity,
    rasData: oriented.data,
    rasDims: oriented.dims,
    rasSpacing,
  });
}

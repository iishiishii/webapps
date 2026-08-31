import { assertDims, voxelCount } from './geometry.js';

export function niftiToCOrder(data, dims, OutputCtor = data.constructor) {
  assertDims(dims);
  const [nx, ny, nz] = dims;
  const result = new OutputCtor(voxelCount(dims));
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        result[x * ny * nz + y * nz + z] = data[x + y * nx + z * nx * ny];
      }
    }
  }
  return result;
}

export function cOrderToNifti(data, dims, OutputCtor = data.constructor) {
  assertDims(dims);
  const [nx, ny, nz] = dims;
  const result = new OutputCtor(voxelCount(dims));
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        result[x + y * nx + z * nx * ny] = data[x * ny * nz + y * nz + z];
      }
    }
  }
  return result;
}

export function transposeXYZToZYX(data, dims, OutputCtor = data.constructor) {
  assertDims(dims);
  const [nx, ny, nz] = dims;
  const result = new OutputCtor(voxelCount(dims));
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        result[z + y * nz + x * nz * ny] = data[x + y * nx + z * nx * ny];
      }
    }
  }
  return { data: result, dims: [nz, ny, nx] };
}

export function transposeZYXToXYZ(data, dims, OutputCtor = data.constructor) {
  assertDims(dims);
  const [nz, ny, nx] = dims;
  const result = new OutputCtor(voxelCount(dims));
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        result[x + y * nx + z * nx * ny] = data[z + y * nz + x * nz * ny];
      }
    }
  }
  return { data: result, dims: [nx, ny, nz] };
}

export function flipVolumeAxes(data, dims, axes, OutputCtor = data.constructor) {
  assertDims(dims);
  const [nx, ny, nz] = dims;
  const result = new OutputCtor(voxelCount(dims));
  const flipX = axes.includes(0);
  const flipY = axes.includes(1);
  const flipZ = axes.includes(2);
  for (let z = 0; z < nz; z++) {
    const sourceZ = flipZ ? nz - 1 - z : z;
    for (let y = 0; y < ny; y++) {
      const sourceY = flipY ? ny - 1 - y : y;
      for (let x = 0; x < nx; x++) {
        const sourceX = flipX ? nx - 1 - x : x;
        result[x + y * nx + z * nx * ny] = data[sourceX + sourceY * nx + sourceZ * nx * ny];
      }
    }
  }
  return { data: result, dims: [...dims] };
}

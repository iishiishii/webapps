(function installMuscleMapMonaiCompat(root) {
  const ORIENTATION_TOLERANCE = 1e-6;

  function identity4() {
    return [
      new Float64Array([1, 0, 0, 0]),
      new Float64Array([0, 1, 0, 0]),
      new Float64Array([0, 0, 1, 0]),
      new Float64Array([0, 0, 0, 1])
    ];
  }

  function multiply4(left, right) {
    const result = identity4();
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        let value = 0;
        for (let inner = 0; inner < 4; inner++) value += left[row][inner] * right[inner][column];
        result[row][column] = value;
      }
    }
    return result;
  }

  function multiply4Float32(left, right) {
    const result = identity4();
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        let value = Math.fround(0);
        for (let inner = 0; inner < 4; inner++) {
          value = Math.fround(value + Math.fround(
            Math.fround(left[row][inner]) * Math.fround(right[inner][column])
          ));
        }
        result[row][column] = value;
      }
    }
    return result;
  }

  function invert4(matrix) {
    const work = Array.from({ length: 4 }, (_, row) => {
      const values = new Float64Array(8);
      values.set(matrix[row], 0);
      values[row + 4] = 1;
      return values;
    });
    for (let column = 0; column < 4; column++) {
      let pivot = column;
      for (let row = column + 1; row < 4; row++) {
        if (Math.abs(work[row][column]) > Math.abs(work[pivot][column])) pivot = row;
      }
      if (Math.abs(work[pivot][column]) < 1e-12) throw new Error('NIfTI affine is not invertible');
      if (pivot !== column) [work[pivot], work[column]] = [work[column], work[pivot]];
      const divisor = work[column][column];
      for (let index = 0; index < 8; index++) work[column][index] /= divisor;
      for (let row = 0; row < 4; row++) {
        if (row === column) continue;
        const factor = work[row][column];
        for (let index = 0; index < 8; index++) work[row][index] -= factor * work[column][index];
      }
    }
    return work.map(row => new Float64Array(row.subarray(4)));
  }

  function transformPoint(matrix, point) {
    const input = [point[0], point[1], point[2], 1];
    const output = new Float64Array(4);
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) output[row] += matrix[row][column] * input[column];
    }
    return [output[0] / output[3], output[1] / output[3], output[2] / output[3]];
  }

  function affineSpacing(affine) {
    return [0, 1, 2].map(column => Math.hypot(
      affine[0][column], affine[1][column], affine[2][column]
    ));
  }

  function getOrientationTransform(affine) {
    const spacing = affineSpacing(affine);
    const directions = Array.from({ length: 3 }, (_, worldAxis) =>
      Array.from({ length: 3 }, (_, inputAxis) => affine[worldAxis][inputAxis] / spacing[inputAxis])
    );
    const permutations = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2],
      [1, 2, 0], [2, 0, 1], [2, 1, 0]
    ];
    let perm = permutations[0];
    let bestScore = -Infinity;
    for (const candidate of permutations) {
      const score = Math.abs(directions[0][candidate[0]]) +
        Math.abs(directions[1][candidate[1]]) +
        Math.abs(directions[2][candidate[2]]);
      if (score > bestScore) {
        bestScore = score;
        perm = candidate;
      }
    }
    return {
      perm: [...perm],
      flip: perm.map((inputAxis, worldAxis) => directions[worldAxis][inputAxis] < 0)
    };
  }

  function orientationIndexTransform(dims, perm, flip) {
    const orientedDims = perm.map(inputAxis => dims[inputAxis]);
    const transform = identity4();
    for (let row = 0; row < 3; row++) transform[row].fill(0);
    for (let outputAxis = 0; outputAxis < 3; outputAxis++) {
      const inputAxis = perm[outputAxis];
      transform[inputAxis][outputAxis] = flip[outputAxis] ? -1 : 1;
      transform[inputAxis][3] = flip[outputAxis] ? orientedDims[outputAxis] - 1 : 0;
    }
    return { orientedDims, transform };
  }

  function orientToRAS(data, dims, affine) {
    const { perm, flip } = getOrientationTransform(affine);
    const { orientedDims, transform } = orientationIndexTransform(dims, perm, flip);
    const [nx, ny] = dims;
    const [dx, dy, dz] = orientedDims;
    const result = new Float32Array(dx * dy * dz);
    for (let oz = 0; oz < dz; oz++) {
      for (let oy = 0; oy < dy; oy++) {
        for (let ox = 0; ox < dx; ox++) {
          const coords = [ox, oy, oz];
          const source = [0, 0, 0];
          for (let axis = 0; axis < 3; axis++) {
            source[perm[axis]] = flip[axis] ? orientedDims[axis] - 1 - coords[axis] : coords[axis];
          }
          result[ox + oy * dx + oz * dx * dy] = data[source[0] + source[1] * nx + source[2] * nx * ny];
        }
      }
    }
    return {
      data: result,
      dims: orientedDims,
      affine: multiply4(affine, transform),
      perm,
      flip
    };
  }

  function roundHalfToEven(value) {
    const lower = Math.floor(value);
    const fraction = value - lower;
    if (Math.abs(fraction - 0.5) < 1e-10) return lower % 2 === 0 ? lower : lower + 1;
    return Math.round(value);
  }

  function invert3(matrix) {
    const [a, b, c] = matrix[0];
    const [d, e, f] = matrix[1];
    const [g, h, i] = matrix[2];
    const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(determinant) < 1e-12) throw new Error('NIfTI affine rotation is not invertible');
    return [
      [(e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant],
      [(f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant],
      [(d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant]
    ];
  }

  function multiply3(left, right) {
    return Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) =>
        left[row].reduce((sum, value, inner) => sum + value * right[inner][column], 0)
      )
    );
  }

  function zoomAffine(affine, spacing) {
    const linear = Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) => affine[row][column])
    );
    const gram = Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) =>
        linear.reduce((sum, values) => sum + values[row] * values[column], 0)
      )
    );
    const lower = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column <= row; column++) {
        let value = gram[row][column];
        for (let inner = 0; inner < column; inner++) value -= lower[row][inner] * lower[column][inner];
        lower[row][column] = row === column ? Math.sqrt(Math.max(value, 0)) : value / lower[column][column];
      }
    }
    const upper = Array.from({ length: 3 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) => lower[column][row])
    );
    const rotation = multiply3(linear, invert3(upper));
    const output = identity4();
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) output[row][column] = rotation[row][column] * spacing[column];
    }
    return output;
  }

  function computeSpacingGeometry(dims, affine, targetSpacing) {
    const sourceSpacing = affineSpacing(affine);
    const actualTarget = targetSpacing.map((value, axis) => value > 0 ? value : sourceSpacing[axis]);
    const zeroOffsetAffine = zoomAffine(affine, actualTarget);
    const outputFromInput = multiply4(invert4(zeroOffsetAffine), affine);
    const inputCorners = [];
    for (const z of [0, dims[2] - 1]) {
      for (const y of [0, dims[1] - 1]) {
        for (const x of [0, dims[0] - 1]) inputCorners.push([x, y, z]);
      }
    }
    const outputCorners = inputCorners.map(point => transformPoint(outputFromInput, point));
    const outputDims = [0, 1, 2].map(axis => {
      const values = outputCorners.map(point => point[axis]);
      return Math.max(1, roundHalfToEven(Math.max(...values) - Math.min(...values) + 1));
    });
    const worldCorners = inputCorners.map(point => transformPoint(affine, point));
    let offset = null;
    for (let corner = 0; corner < outputCorners.length; corner++) {
      const candidate = outputCorners[corner];
      const isMinimum = [0, 1, 2].every(axis => outputCorners.every(
        point => point[axis] >= candidate[axis] - 1e-3
      ));
      if (isMinimum) {
        offset = worldCorners[corner];
        break;
      }
    }
    if (!offset) {
      const inputCenter = transformPoint(affine, dims.map(value => value / 2));
      offset = inputCenter.map((value, axis) => value - actualTarget[axis] * outputDims[axis] / 2);
    }
    const outputAffine = zeroOffsetAffine;
    for (let axis = 0; axis < 3; axis++) outputAffine[axis][3] = offset[axis];
    return { dims: outputDims, affine: outputAffine, spacing: actualTarget };
  }

  function sampleTrilinearBorder(data, dims, x, y, z) {
    const [nx, ny, nz] = dims;
    const sx = Math.min(nx - 1, Math.max(0, x));
    const sy = Math.min(ny - 1, Math.max(0, y));
    const sz = Math.min(nz - 1, Math.max(0, z));
    const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, nx - 1), wx = sx - x0;
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, ny - 1), wy = sy - y0;
    const z0 = Math.floor(sz), z1 = Math.min(z0 + 1, nz - 1), wz = sz - z0;
    const plane = nx * ny;
    const c000 = data[x0 + y0 * nx + z0 * plane];
    const c100 = data[x1 + y0 * nx + z0 * plane];
    const c010 = data[x0 + y1 * nx + z0 * plane];
    const c110 = data[x1 + y1 * nx + z0 * plane];
    const c001 = data[x0 + y0 * nx + z1 * plane];
    const c101 = data[x1 + y0 * nx + z1 * plane];
    const c011 = data[x0 + y1 * nx + z1 * plane];
    const c111 = data[x1 + y1 * nx + z1 * plane];
    const c00 = c000 * (1 - wx) + c100 * wx;
    const c10 = c010 * (1 - wx) + c110 * wx;
    const c01 = c001 * (1 - wx) + c101 * wx;
    const c11 = c011 * (1 - wx) + c111 * wx;
    return (c00 * (1 - wy) + c10 * wy) * (1 - wz) +
      (c01 * (1 - wy) + c11 * wy) * wz;
  }

  function createTorchGridTransform(sourceAffine, sourceDims, outputAffine, outputDims) {
    const sourceFromOutput = multiply4(invert4(sourceAffine), outputAffine);
    const normalizeSource = identity4();
    const denormalizeOutput = identity4();
    for (let axis = 0; axis < 3; axis++) {
      normalizeSource[axis][axis] = Math.fround(2 / sourceDims[axis]);
      normalizeSource[axis][3] = Math.fround(1 / sourceDims[axis] - 1);
      denormalizeOutput[axis][axis] = Math.fround(outputDims[axis] / 2);
      denormalizeOutput[axis][3] = Math.fround((outputDims[axis] - 1) / 2);
    }
    const normalized = multiply4Float32(
      multiply4Float32(normalizeSource, sourceFromOutput),
      denormalizeOutput
    );
    const reversed = identity4();
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) reversed[row][column] = normalized[2 - row][2 - column];
      reversed[row][3] = normalized[2 - row][3];
    }
    return reversed;
  }

  function torchGridSourcePoint(transform, outputPoint, sourceDims, outputDims) {
    const outputReversed = [outputPoint[2], outputPoint[1], outputPoint[0]];
    const normalizedOutput = outputReversed.map((coordinate, axis) => {
      const size = outputDims[2 - axis];
      if (size === 1) return 0;
      const alignCornersCoordinate = Math.fround(-1 + coordinate * (2 / (size - 1)));
      return Math.fround(alignCornersCoordinate * Math.fround((size - 1) / size));
    });
    const normalizedSource = [0, 1, 2].map(row => {
      let value = Math.fround(transform[row][3]);
      for (let column = 0; column < 3; column++) {
        value = Math.fround(value + Math.fround(transform[row][column] * normalizedOutput[column]));
      }
      return value;
    });
    const sourceReversed = normalizedSource.map((coordinate, axis) => {
      const size = sourceDims[2 - axis];
      return Math.fround(Math.fround(Math.fround(coordinate + 1) * size - 1) / 2);
    });
    return [sourceReversed[2], sourceReversed[1], sourceReversed[0]];
  }

  function resampleVolume(data, dims, affine, targetSpacing) {
    const geometry = computeSpacingGeometry(dims, affine, targetSpacing);
    const gridTransform = createTorchGridTransform(affine, dims, geometry.affine, geometry.dims);
    const [nx, ny, nz] = geometry.dims;
    const result = new Float32Array(nx * ny * nz);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const source = torchGridSourcePoint(gridTransform, [x, y, z], dims, geometry.dims);
          result[x + y * nx + z * nx * ny] = sampleTrilinearBorder(data, dims, ...source);
        }
      }
    }
    return { data: result, ...geometry };
  }

  function connectedComponents3D6(binaryMask, dims) {
    const [nx, ny, nz] = dims;
    const labels = new Int32Array(nx * ny * nz);
    const parent = [0];
    const rank = [0];
    let nextLabel = 1;
    function find(value) {
      while (parent[value] !== value) {
        parent[value] = parent[parent[value]];
        value = parent[value];
      }
      return value;
    }
    function union(left, right) {
      left = find(left);
      right = find(right);
      if (left === right) return;
      if (rank[left] < rank[right]) [left, right] = [right, left];
      parent[right] = left;
      if (rank[left] === rank[right]) rank[left]++;
    }
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const index = x + y * nx + z * nx * ny;
          if (!binaryMask[index]) continue;
          const neighbors = [];
          if (x > 0 && labels[index - 1]) neighbors.push(labels[index - 1]);
          if (y > 0 && labels[index - nx]) neighbors.push(labels[index - nx]);
          if (z > 0 && labels[index - nx * ny]) neighbors.push(labels[index - nx * ny]);
          if (!neighbors.length) {
            labels[index] = nextLabel;
            parent.push(nextLabel);
            rank.push(0);
            nextLabel++;
          } else {
            labels[index] = neighbors[0];
            for (let neighbor = 1; neighbor < neighbors.length; neighbor++) union(labels[index], neighbors[neighbor]);
          }
        }
      }
    }
    const canonical = new Map();
    let numComponents = 0;
    for (let index = 0; index < labels.length; index++) {
      if (!labels[index]) continue;
      const rootLabel = find(labels[index]);
      if (!canonical.has(rootLabel)) canonical.set(rootLabel, ++numComponents);
      labels[index] = canonical.get(rootLabel);
    }
    return { labels, numComponents };
  }

  root.MuscleMapMonaiCompat = {
    affineSpacing,
    computeSpacingGeometry,
    connectedComponents3D6,
    createTorchGridTransform,
    getOrientationTransform,
    identity4,
    invert4,
    multiply4,
    orientToRAS,
    orientationIndexTransform,
    resampleVolume,
    torchGridSourcePoint,
    transformPoint,
    ORIENTATION_TOLERANCE
  };
})(globalThis);

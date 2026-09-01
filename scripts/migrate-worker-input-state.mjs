#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const workerPath = (app) => join(repoRoot, 'apps', app, 'web', 'js', 'inference-worker.js');

function addToolkitImports(source, names) {
  return source.replace(
    /import \{ ([^\n]+) \} from '(\.\.\/vendor\/webapp-components\/src\/worker\/index\.js)';/,
    (_match, imports, specifier) => `import { ${[...new Set([...imports.split(', '), ...names])].sort().join(', ')} } from '${specifier}';`,
  );
}

function removeLocalThreadPolicy(source) {
  return source.replace(/\nfunction getOptimalWasmThreads\(\) \{[\s\S]*?\n\}\n/, '\n');
}

function replaceInputFunction(source, body) {
  const start = source.indexOf('function loadStateFromInput(');
  const end = source.indexOf('\nfunction stepLoad(', start);
  if (start < 0) return source;
  if (end < 0) throw new Error('Could not find stepLoad after loadStateFromInput');
  return `${source.slice(0, start)}${body.trim()}\n${source.slice(end + 1)}`.replaceAll('loadStateFromInput(', 'prepareInputState(');
}

const commonStart = `function prepareInputState(inputData, { emitUpdates = false } = {}) {
  if (emitUpdates) {
    postLog('Parsing input volume...');
    postProgress(0.02, 'Reading NIfTI...');
  }
  const prepared = prepareRasWorkerInput(parseNiftiInput(inputData));
  Object.assign(workerState, prepared);
  if (emitUpdates) {
    postLog(\`Volume: \${prepared.origDims.join('x')}, spacing: \${prepared.rasSpacing.map(value => value.toFixed(3)).join('x')}mm\`);
    postLog(\`RAS dims: \${prepared.rasDims.join('x')}\`);
  }
`;

const bodies = {
  calmar: `${commonStart}
  workerState.segLabelsRAS = null;
  workerState.segMinComponentSize = 10;
  if (emitUpdates) postVolumeInfo({ rasDims: [...prepared.rasDims], rasSpacing: [...prepared.rasSpacing], totalSlices: prepared.rasDims[2] });
  return {
    ...prepared,
    origDims: [...prepared.origDims],
    headerBytes: prepared.headerBytes.slice(0),
    origHeaderBytes: prepared.origHeaderBytes.slice(0),
    affine: prepared.affine.map(row => Array.from(row)),
    perm: [...prepared.perm],
    flip: [...prepared.flip],
    rasData: new Float32Array(prepared.rasData),
    rasDims: [...prepared.rasDims],
    rasSpacing: [...prepared.rasSpacing],
  };
}`,
  spinalcordtoolbox: `${commonStart}
  workerState.segLabelsRAS = null;
  workerState.lesionLabelsRAS = null;
  workerState.segMinComponentSize = 10;
  postVolumeInfo({ rasDims: [...prepared.rasDims], rasSpacing: [...prepared.rasSpacing], totalSlices: prepared.rasDims[2] });
}`,
  vesselboost: `${commonStart}
  workerState.nativeRasSpacing = [...prepared.rasSpacing];
  workerState.brainMask = null;
  workerState.preBETMask = null;
  workerState.denoisedData = null;
  workerState.preDenoiseData = null;
  workerState.segLabelsRAS = null;
  workerState.segMinComponentSize = 10;
  postVolumeInfo({ rasDims: [...prepared.rasDims], rasSpacing: [...prepared.rasSpacing], totalSlices: prepared.rasDims[2] });
}`,
};

for (const app of ['calmar', 'spinalcordtoolbox', 'vesselboost']) {
  const path = workerPath(app);
  let source = await readFile(path, 'utf8');
  source = addToolkitImports(source, ['getOptimalWasmThreads', 'prepareRasWorkerInput']);
  source = removeLocalThreadPolicy(source);
  source = replaceInputFunction(source, bodies[app]);
  source = source.replace(/^\s*getOrientationTransform,\n/m, '').replace(/^\s*orientToRAS,\n/m, '');
  await writeFile(path, source);
}

for (const app of ['musclemap', 'seedseg']) {
  const path = workerPath(app);
  let source = await readFile(path, 'utf8');
  source = addToolkitImports(source, ['getOptimalWasmThreads']);
  source = removeLocalThreadPolicy(source);
  source = source.replace('navigator.hardwareConcurrency > 1 ? 2 : 1', 'getOptimalWasmThreads()');
  await writeFile(path, source);
}

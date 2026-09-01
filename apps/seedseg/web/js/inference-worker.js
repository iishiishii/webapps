/**
 * SeedSeg Inference Worker
 *
 * Runs ONNX model inference and consensus segmentation in a Web Worker.
 * Pipeline: NIfTI parse → preprocess → run N models → consensus → output
 */

import * as ort from '../wasm/ort.webgpu.bundle.min.mjs';
import { createWorkerEmitter, fetchModel as fetchModelAsset, getOptimalWasmThreads, installWorkerRouter, localForageCache } from '../vendor/webapp-components/src/worker/index.js';
import { createNiftiFromData, parseNiftiVolume } from '../vendor/webapp-components/src/file-io/NiftiUtils.js';
import { connectedComponents3D } from '../vendor/webapp-components/src/volume/connectedComponents.js';
import { cOrderToNifti, niftiToCOrder } from '../vendor/webapp-components/src/volume/layout.js';
import { zScoreNormalize } from '../vendor/webapp-components/src/volume/normalization.js';
import { cropCenteredVolume, padVolumeCentered } from '../vendor/webapp-components/src/volume/padding.js';

let localforage;
let nifti;
let dependenciesReady;

function loadDependencies() {
  dependenciesReady ||= Promise.all([
    import('https://cdn.jsdelivr.net/npm/localforage@1.10.0/+esm'),
    import('../nifti-js/index.js')
  ]).then(([localForageModule]) => {
    localforage = localForageModule.default;
    nifti = globalThis.nifti;
    if (!localforage || !nifti) throw new Error('SeedSeg worker dependencies failed to initialize');
    return { localforage, nifti };
  });
  return dependenciesReady;
}

// QSM WASM module (for bias field correction)
let qsmWasm = null;

// ==================== Message Helpers ====================

const workerMessages = createWorkerEmitter(self);
const {
  complete: postComplete,
  error: postError,
  log: postLog,
  progress: postProgress,
} = workerMessages;

function postStageData(stage, niftiData, description) {
  workerMessages.stageData(stage, niftiData, description);
}

// ==================== NIfTI Utilities ====================

function parseNiftiInput(arrayBuffer) {
  return parseNiftiVolume(arrayBuffer, { decompress: buffer => nifti.decompress(buffer) });
}

function createOutputNifti(float32Data, sourceHeader) {
  return createNiftiFromData(float32Data, sourceHeader);
}

// ==================== Preprocessing ====================

function findPaddedDims(dims, factor) {
  return dims.map(d => Math.ceil(d / factor) * factor);
}




// ==================== Axis Transposition ====================
// NIfTI stores data in Fortran order (x varies fastest): index = x + y*nx + z*nx*ny
// ONNX Runtime expects C-contiguous (last dim varies fastest): index = x*ny*nz + y*nz + z
// These functions convert between the two layouts for shape [nx, ny, nz].



// ==================== Post-processing ====================

function softmaxExtractClass1(rawOutput, voxelCount, numClasses) {
  const result = new Float32Array(voxelCount);

  for (let v = 0; v < voxelCount; v++) {
    let maxLogit = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const logit = rawOutput[c * voxelCount + v];
      if (logit > maxLogit) maxLogit = logit;
    }

    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) {
      sumExp += Math.exp(rawOutput[c * voxelCount + v] - maxLogit);
    }

    result[v] = Math.exp(rawOutput[1 * voxelCount + v] - maxLogit) / sumExp;
  }

  return result;
}

function selectTopNMarkers(probabilityMap, dims, nMarkers, threshold) {
  const n = probabilityMap.length;

  const binaryMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    binaryMask[i] = probabilityMap[i] > threshold ? 1 : 0;
  }

  const { labels, numComponents } = connectedComponents3D(binaryMask, dims);

  if (numComponents === 0) return new Float32Array(n);

  if (numComponents <= nMarkers) {
    const result = new Float32Array(n);
    for (let i = 0; i < n; i++) result[i] = labels[i] > 0 ? 1.0 : 0.0;
    return result;
  }

  const componentSum = new Float64Array(numComponents + 1);
  const componentCount = new Int32Array(numComponents + 1);

  for (let i = 0; i < n; i++) {
    if (labels[i] > 0) {
      componentSum[labels[i]] += probabilityMap[i];
      componentCount[labels[i]]++;
    }
  }

  const scores = [];
  for (let c = 1; c <= numComponents; c++) {
    scores.push({ label: c, meanProb: componentSum[c] / componentCount[c] });
  }
  scores.sort((a, b) => b.meanProb - a.meanProb);

  const keepLabels = new Set();
  for (let i = 0; i < Math.min(nMarkers, scores.length); i++) {
    keepLabels.add(scores[i].label);
  }

  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = keepLabels.has(labels[i]) ? 1.0 : 0.0;
  }
  return result;
}

function averageProbabilityMaps(maps) {
  const n = maps[0].length;
  const result = new Float32Array(n);
  for (let m = 0; m < maps.length; m++) {
    const map = maps[m];
    for (let i = 0; i < n; i++) result[i] += map[i];
  }
  const count = maps.length;
  for (let i = 0; i < n; i++) result[i] /= count;
  return result;
}

// ==================== Model Loading ====================

async function fetchModel(url, modelName, progressBase, progressSpan) {
  const displayName = modelName || url.split("/").pop();
  const bytes = await fetchModelAsset(
    { url, urls: [url, url], cacheKey: url, integrity: { minBytes: 1000001 } },
    {
      cache: localForageCache(localforage),
      onInvalidCache: error => postLog(`Discarding cached model: ${error.message}`),
      onCacheError: () => postLog("Warning: Could not cache model (storage full?)"),
      onProgress: ({ received, total, fraction }) => {
        if (fraction === null) return;
        const mb = (received / 1048576).toFixed(1);
        const totalMb = (total / 1048576).toFixed(0);
        postProgress(progressBase + fraction * progressSpan, `Downloading ${displayName} (${mb}/${totalMb} MB)`);
      }
    }
  );
  postLog(`Loaded: ${displayName} (${(bytes.byteLength / 1048576).toFixed(1)} MB)`);
  return bytes;
}

// ==================== Main Inference Pipeline ====================

async function runInference(config) {
  const { inputData, settings } = config;
  const {
    selectedModels,
    threshold = 0.1,
    nMarkers = 3,
    modelBaseUrl
  } = settings;

  // 1. Parse NIfTI input
  postLog('Parsing input volume...');
  postProgress(0.02, 'Reading NIfTI...');
  const { imageData, dims, voxelSize, headerBytes } = parseNiftiInput(inputData);
  const [nx, ny, nz] = dims;
  const [vx, vy, vz] = voxelSize;
  postLog(`Volume dimensions: ${nx} x ${ny} x ${nz}, voxel: ${vx.toFixed(2)} x ${vy.toFixed(2)} x ${vz.toFixed(2)}mm`);

  // 2. Bias field correction (makehomogeneous)
  postProgress(0.05, 'Bias field correction...');
  postLog('Running bias field correction...');
  const mag64 = new Float64Array(imageData);
  const corrected64 = qsmWasm.makehomogeneous_wasm(mag64, nx, ny, nz, vx, vy, vz, 7.0, 15);
  const correctedData = new Float32Array(corrected64);
  postLog('Bias field correction complete');

  // 3. Pad, normalize, and transpose to C-contiguous for ONNX
  postProgress(0.10, 'Normalizing...');
  const paddedDims = findPaddedDims(dims, 32);
  const paddedData = padVolumeCentered(correctedData, dims, paddedDims);
  const normalizedData = zScoreNormalize(paddedData);
  const [pnx, pny, pnz] = paddedDims;
  const tensorData = niftiToCOrder(normalizedData, [pnx, pny, pnz]);
  postLog(`Padded to: ${pnx} x ${pny} x ${pnz}`);

  // 4. Run each model
  const allProbMaps = [];
  const totalModels = selectedModels.length;

  for (let i = 0; i < totalModels; i++) {
    const modelName = selectedModels[i];
    const modelUrl = `${modelBaseUrl}/${modelName}`;
    const perModelSpan = 0.65 / totalModels;
    const progressBase = 0.15 + i * perModelSpan;
    const dlSpan = perModelSpan * 0.6;   // 60% of per-model span for download
    const runBase = progressBase + dlSpan; // remaining 40% for inference

    // Fetch model (with download progress)
    const modelData = await fetchModel(modelUrl, modelName, progressBase, dlSpan);

    // Create ONNX session
    postProgress(runBase, `Loading model ${i + 1}/${totalModels}...`);
    postLog('Creating ONNX InferenceSession...');
    let session;
    try {
      session = await ort.InferenceSession.create(modelData, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      });
    } catch (e) {
      postLog(`Session creation failed: ${e?.message || String(e)}`);
      throw e;
    }
    postLog(`Session created. Inputs: ${session.inputNames}, Outputs: ${session.outputNames}`);

    // Create input tensor [1, 1, nx, ny, nz] — C-contiguous
    postProgress(runBase + perModelSpan * 0.2, `Running model ${i + 1}/${totalModels}...`);
    const inputTensor = new ort.Tensor(
      'float32',
      tensorData,
      [1, 1, pnx, pny, pnz]
    );

    // Run inference
    postLog('Running inference...');
    const inputName = session.inputNames[0];
    let results;
    try {
      results = await session.run({ [inputName]: inputTensor });
    } catch (e) {
      postLog(`Inference run failed: ${e?.message || String(e)}`);
      throw e;
    }
    const outputName = session.outputNames[0];
    const rawOutput = results[outputName].data;

    // Softmax and extract class 1 probability (output is C-contiguous)
    const voxelCount = pnx * pny * pnz;
    const probMapC = softmaxExtractClass1(rawOutput, voxelCount, 3);

    // Transpose output back to NIfTI order, then crop
    const probMapNifti = cOrderToNifti(probMapC, [pnx, pny, pnz]);
    const croppedProb = cropCenteredVolume(probMapNifti, paddedDims, dims);
    allProbMaps.push(croppedProb);

    // Send individual model result as NIfTI
    const modelNifti = createOutputNifti(croppedProb, headerBytes);
    postStageData(`model${i + 1}`, modelNifti, `Model ${i + 1} seed probability`);

    // Cleanup
    inputTensor.dispose();
    await session.release();

    postLog(`Model ${i + 1}/${totalModels} complete`);
  }

  // 5. Average probability maps
  postProgress(0.85, 'Computing consensus...');
  const avgProb = averageProbabilityMaps(allProbMaps);
  const avgNifti = createOutputNifti(avgProb, headerBytes);
  postStageData('avgProb', avgNifti, 'Average probability');

  // 6. Connected component labeling + top-N selection
  postProgress(0.92, 'Selecting markers...');
  const consensusMask = selectTopNMarkers(avgProb, dims, nMarkers, threshold);
  const consensusNifti = createOutputNifti(consensusMask, headerBytes);
  postStageData('consensus', consensusNifti, 'Consensus segmentation');

  // Count marker voxels
  let markerVoxels = 0;
  for (let i = 0; i < consensusMask.length; i++) {
    if (consensusMask[i] > 0) markerVoxels++;
  }
  postLog(`Consensus: ${markerVoxels} voxels in final segmentation`);

  postProgress(1.0, 'Complete');
  postComplete();
}

// ==================== Message Handler ====================

installWorkerRouter({
  scope: self,
  getServices: loadDependencies,
  handle: async ({ type, data }) => {

  switch (type) {
    case 'init':
      try {
        ort.env.wasm.numThreads = getOptimalWasmThreads();
        ort.env.wasm.wasmPaths = '../wasm/';

        localforage.config({
          name: 'SeedSegModelCache',
          storeName: 'models'
        });

        // Initialize QSM WASM (for bias field correction)
        const baseUrl = self.location.href.replace(/\/js\/.*$/, '');
        const wasmJsUrl = `${baseUrl}/wasm/qsm_wasm.js`;
        const wasmBinaryUrl = `${baseUrl}/wasm/qsm_wasm_bg.wasm`;
        qsmWasm = await import(wasmJsUrl);
        await qsmWasm.default(wasmBinaryUrl);

        workerMessages.initialized();
      } catch (error) {
        postError(`Initialization failed: ${error.message}`);
      }
      break;

    case 'run':
      try {
        await runInference(data);
      } catch (error) {
        console.error('Inference error:', error);
        const msg = error?.message || String(error);
        postError(msg);
      }
      break;
  }
  }
});

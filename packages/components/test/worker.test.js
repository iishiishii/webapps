import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkerEmitter,
  fetchModel,
  getOptimalWasmThreads,
  installWorkerRouter,
  prepareRasWorkerInput,
  WorkerSession,
} from '../src/worker/index.js';

test('worker router installs synchronously and starts services only on dispatch', async () => {
  const calls = [];
  const scope = { postMessage: message => calls.push(message), onmessage: null };
  let servicesStarted = false;
  installWorkerRouter({
    scope,
    getServices: async () => {
      servicesStarted = true;
      return { ready: true };
    },
    handlers: {
      init(_data, { services }) { calls.push(services); },
    },
  });
  assert.equal(typeof scope.onmessage, 'function');
  assert.equal(servicesStarted, false);
  await scope.onmessage({ data: { type: 'init', data: {} } });
  assert.equal(servicesStarted, true);
  assert.deepEqual(calls, [{ ready: true }]);
});

test('worker session owns one worker and fans out messages without exposing transport', () => {
  const posted = [];
  const worker = {
    postMessage: (message, transfer) => posted.push({ message, transfer }),
    terminateCalled: false,
    terminate() { this.terminateCalled = true; },
  };
  const session = new WorkerSession({ createWorker: () => worker });
  const received = [];
  session.subscribe((message) => received.push(message));
  session.start();
  session.send({ type: 'init' });
  worker.onmessage({ data: { type: 'initialized' } });
  assert.deepEqual(posted, [{ message: { type: 'init' }, transfer: [] }]);
  assert.deepEqual(received, [{ type: 'initialized' }]);
  session.terminate();
  assert.equal(worker.terminateCalled, true);
});

test('worker emitter recursively transfers stage buffers', () => {
  let posted;
  const emit = createWorkerEmitter({ postMessage: (message, transfer) => { posted = { message, transfer }; } });
  const bytes = new Uint8Array([1, 2, 3]);
  emit.stageData('segmentation', bytes, 'Result');
  assert.equal(posted.message.type, 'stageData');
  assert.deepEqual(posted.transfer, [bytes.buffer]);
});

test('fetchModel rejects truncated bytes before cache commit', async () => {
  let cached = false;
  await assert.rejects(fetchModel(
    { url: '/model.onnx', cacheKey: 'model', integrity: { bytes: 4 } },
    {
      fetch: async () => ({ ok: true, headers: new Map(), body: null, arrayBuffer: async () => new Uint8Array([1, 2]).buffer }),
      cache: { get: async () => null, set: async () => { cached = true; } },
    },
  ), /size mismatch/);
  assert.equal(cached, false);
});

test('WASM threads are enabled only in a cross-origin-isolated worker', () => {
  assert.equal(getOptimalWasmThreads({ hardwareConcurrency: 12, crossOriginIsolated: false }), 1);
  assert.equal(getOptimalWasmThreads({ hardwareConcurrency: 12, crossOriginIsolated: true }), 12);
  assert.equal(getOptimalWasmThreads({ hardwareConcurrency: Number.NaN, crossOriginIsolated: true }), 1);
});

test('RAS input preparation preserves the native header and rewrites an owned copy', () => {
  const headerBytes = new ArrayBuffer(348);
  const prepared = prepareRasWorkerInput({
    imageData: new Uint8Array([1, 2]),
    dims: [2, 1, 1],
    voxelSize: [1, 2, 3],
    headerBytes,
    affine: [[-1, 0, 0, 1], [0, 2, 0, 0], [0, 0, 3, 0], [0, 0, 0, 1]],
  });
  assert.notEqual(prepared.headerBytes, headerBytes);
  assert.deepEqual(new Uint8Array(prepared.origHeaderBytes), new Uint8Array(headerBytes));
  assert.deepEqual([...prepared.rasData], [2, 1]);
  assert.deepEqual(prepared.rasDims, [2, 1, 1]);
  assert.equal(new DataView(prepared.headerBytes).getInt16(254, true), 1);
  assert.equal(new DataView(headerBytes).getInt16(254, true), 0);
});

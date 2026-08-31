import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerEmitter, fetchModel, installWorkerRouter } from '../src/worker/index.js';

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

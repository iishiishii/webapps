import assert from 'node:assert/strict';
import test from 'node:test';
import { isUrlWithinServiceWorkerScope } from '../scripts/lib/runtime-support.mjs';

test('thread workers must stay inside the COI service-worker scope', () => {
  const serviceWorker = 'https://example.test/musclemap/coi-serviceworker.js';

  assert.equal(
    isUrlWithinServiceWorkerScope(
      serviceWorker,
      'https://example.test/musclemap/wasm/ort-wasm-simd-threaded.jsep.mjs',
    ),
    true,
  );
  assert.equal(
    isUrlWithinServiceWorkerScope(
      serviceWorker,
      'https://example.test/_runtime/ort-web/1.21.0/ort-wasm-simd-threaded.jsep.mjs',
    ),
    false,
  );
  assert.equal(
    isUrlWithinServiceWorkerScope(
      serviceWorker,
      'https://example.test/musclemap-other/wasm/ort-wasm-simd-threaded.jsep.mjs',
    ),
    false,
  );
});

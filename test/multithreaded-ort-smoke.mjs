const TINY_NEG_MODEL_BASE64 = 'CAcSDGJhY2tlbmQtdGVzdDpBCgsKAXgSAXkiA05lZxIQdGVzdF9uZWdfZXhhbXBsZVoPCgF4EgoKCAgBEgQKAggCYg8KAXkSCgoICAESBAoCCAJCBAoAEA0=';

export async function verifyMuscleMapThreads(page, appUrl) {
  const result = await page.evaluate(async ({ appUrl, modelBase64 }) => {
    const threadCount = navigator.hardwareConcurrency || 4;
    if (threadCount < 2) throw new Error(`multithreaded ORT smoke needs at least two hardware threads, got ${threadCount}`);

    const workerSource = `
      self.onmessage = async ({ data }) => {
        try {
          importScripts(data.ortUrl);
          ort.env.wasm.numThreads = data.threadCount;
          ort.env.wasm.wasmPaths = data.wasmBase;
          const model = Uint8Array.from(atob(data.modelBase64), character => character.charCodeAt(0));
          const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
          const feeds = { x: new ort.Tensor('float32', new Float32Array([1, -2]), [2]) };
          const output = await session.run(feeds);
          self.postMessage({ threadCount: ort.env.wasm.numThreads, values: Array.from(output.y.data) });
        } catch (error) {
          self.postMessage({ error: error?.stack || error?.message || String(error) });
        }
      };
    `;
    const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
    const workerResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('multithreaded ORT smoke timed out')), 30_000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timeout);
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = ({ message }) => {
        clearTimeout(timeout);
        reject(new Error(message));
      };
      worker.postMessage({
        modelBase64,
        threadCount,
        ortUrl: new URL('wasm/ort.webgpu.min.js', appUrl).href,
        wasmBase: new URL('wasm/', appUrl).href,
      });
    });
    worker.terminate();
    return { ...workerResult, hardwareConcurrency: threadCount };
  }, { appUrl, modelBase64: TINY_NEG_MODEL_BASE64 });

  if (result.threadCount !== result.hardwareConcurrency) {
    throw new Error(`ORT used ${result.threadCount} of ${result.hardwareConcurrency} threads`);
  }
  if (JSON.stringify(result.values) !== JSON.stringify([-1, 2])) {
    throw new Error(`multithreaded ORT returned ${JSON.stringify(result.values)}`);
  }
  return result;
}

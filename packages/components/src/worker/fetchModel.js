export async function fetchModel(asset, options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    cache = null,
    signal,
    onProgress = () => {},
  } = options;
  const normalized = typeof asset === 'string' ? { url: asset, cacheKey: asset } : asset;
  if (!normalized?.url) throw new Error('fetchModel requires an asset URL');
  if (typeof fetchImpl !== 'function') throw new Error('fetchModel requires fetch');

  const cacheKey = normalized.cacheKey || normalized.url;
  const cached = cache ? await cache.get(cacheKey) : null;
  if (cached) {
    const bytes = toArrayBuffer(cached);
    try {
      await verifyModel(bytes, normalized.integrity);
      return bytes;
    } catch (error) {
      await cache.delete?.(cacheKey);
      options.onInvalidCache?.(error);
    }
  }

  const urls = normalized.urls || [normalized.url];
  let response;
  let selectedUrl;
  let lastError;
  for (const url of urls) {
    try {
      const candidate = await fetchImpl(url, { signal, cache: options.requestCache });
      if (!candidate.ok) throw new Error(`Model download failed (${candidate.status}): ${url}`);
      response = candidate;
      selectedUrl = url;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) throw lastError || new Error(`Model download failed: ${normalized.url}`);
  const expected = normalized.integrity?.bytes || Number(response.headers?.get?.('content-length')) || 0;
  let bytes;
  if (!response.body?.getReader) {
    bytes = await response.arrayBuffer();
  } else {
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      onProgress({ received, total: expected, fraction: expected ? received / expected : null });
    }
    bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    bytes = bytes.buffer;
  }

  await verifyModel(bytes, normalized.integrity);
  if (cache) {
    try {
      await cache.set(cacheKey, bytes.slice(0));
    } catch (error) {
      options.onCacheError?.(error);
    }
  }
  options.onDownloaded?.({ url: selectedUrl, bytes: bytes.byteLength });
  return bytes;
}

async function verifyModel(bytes, integrity = {}) {
  if (integrity.bytes && bytes.byteLength !== integrity.bytes) {
    throw new Error(`Model size mismatch: expected ${integrity.bytes} bytes, received ${bytes.byteLength}`);
  }
  if (integrity.minBytes && bytes.byteLength < integrity.minBytes) {
    throw new Error(`Model is truncated: expected at least ${integrity.minBytes} bytes, received ${bytes.byteLength}`);
  }
  if (integrity.sha256) {
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification requires Web Crypto');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const actual = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== integrity.sha256.toLowerCase()) throw new Error('Model SHA-256 mismatch');
  }
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  throw new Error('Model cache returned unsupported data');
}

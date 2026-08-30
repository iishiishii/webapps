#!/bin/bash
# One-time setup: fetch the manifest-pinned ONNX Runtime Web files. File names,
# URLs, and sha256 checksums come from runtime-assets/manifest.json via the
# shared fetcher.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/../../../scripts/fetch-app-runtime.mjs" --dest "$SCRIPT_DIR/wasm" \
  ort-web:ort.webgpu.min.js,ort-wasm-simd-threaded.mjs,ort-wasm-simd-threaded.wasm,ort-wasm-simd-threaded.jsep.mjs,ort-wasm-simd-threaded.jsep.wasm

echo ""
echo "Note: SCT task metadata is recorded in: $SCRIPT_DIR/models/manifest.json"
echo "      Scientific assets are fetched on demand from immutable manifest URLs."

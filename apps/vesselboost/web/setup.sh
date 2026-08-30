#!/bin/bash
# One-time setup: fetch the manifest-pinned ONNX Runtime Web files and build
# the optional Rust preprocessing WASM. File names, URLs, and sha256 checksums
# come from runtime-assets/manifest.json via the shared fetcher.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SCRIPT_DIR/../../../scripts/fetch-app-runtime.mjs" --dest "$SCRIPT_DIR/wasm" \
  ort-web:ort.webgpu.min.js,ort-wasm-simd-threaded.mjs,ort-wasm-simd-threaded.wasm,ort-wasm-simd-threaded.jsep.mjs,ort-wasm-simd-threaded.jsep.wasm

# Build preprocessing WASM if rust-preprocessing/ exists and wasm-pack is installed
RUST_DIR="$SCRIPT_DIR/../rust-preprocessing"
if [[ -d "$RUST_DIR" ]] && command -v wasm-pack &>/dev/null; then
  echo ""
  echo "Building preprocessing WASM..."
  cd "$RUST_DIR"
  bash build.sh
  echo "Preprocessing WASM built and copied to web/preprocessing-wasm/"
else
  echo ""
  echo "Note: Preprocessing WASM not built (rust-preprocessing/ not found or wasm-pack not installed)"
  echo "  Install wasm-pack: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
fi

echo ""
echo "Note: Place your ONNX model file in: $SCRIPT_DIR/models/vesselboost.onnx"

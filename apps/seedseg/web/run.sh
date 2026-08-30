#!/bin/bash
# Thin wrapper kept for tooling that runs `bash web/run.sh [port]`; the server
# itself is the shared scripts/dev-server.mjs (which also sends the COOP/COEP
# headers SharedArrayBuffer needs, so local dev no longer depends solely on
# coi-serviceworker.js).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/../../../scripts/dev-server.mjs" --dir "$SCRIPT_DIR" --port "${1:-8080}"

#!/bin/bash
# Thin wrapper kept for tooling that runs `bash web/run.sh [port]`; the server
# itself is the shared scripts/dev-server.mjs, which keeps the PID-file
# takeover contract (stop an existing dev server on the port first) that
# scripts/test_run_server_restart.sh pins.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/../../../scripts/dev-server.mjs" --dir "$SCRIPT_DIR" --port "${1:-8080}" --cache-policy 'no-store, must-revalidate'

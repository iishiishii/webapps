#!/bin/bash
# Thin wrapper kept for tooling that runs `bash web/run.sh [port]`; the server
# itself is the shared scripts/dev-server.mjs. The flags preserve the CALMaR
# dev contract: PID-file takeover, no-store serving, the /__lnm_downloads/
# staged mask download route (X-LNM-Stage-Only + same-origin attachment
# downloads), and a build-info.json written from git on startup.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/../../../scripts/dev-server.mjs" --dir "$SCRIPT_DIR" --port "${1:-8080}" \
  --cache-policy 'no-store, must-revalidate' --staging-route /__lnm_downloads/ --build-info

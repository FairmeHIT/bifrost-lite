#!/usr/bin/env bash
# Bifrost local dev environment launcher.
#
# Port 8080 is occupied by another project on this machine (iq_radar), so the
# API runs on 8090 and the vite dev server proxies /api to it.
#
# Usage: ./scripts/dev-8090.sh
#   - API:  http://localhost:8090  (air hot-reload, data in ./bifrost-data)
#   - UI:   http://localhost:3000  (vite dev server, HMR)
#
# Stop with Ctrl-C (kills both processes).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GOCACHE="$ROOT/tmp/gocache"

echo "Starting Bifrost API on :8090 (air hot reload)..."
(cd "$ROOT/transports/bifrost-http" && BIFROST_UI_DEV=true air -c .air.toml -- \
  -port 8090 -app-dir "$ROOT/bifrost-data" -log-style pretty) &
API_PID=$!

echo "Starting UI dev server on :3000 (vite, proxy -> :8090)..."
(cd "$ROOT/ui" && BIFROST_PORT=8090 BIFROST_UI_DEV=true npm run dev) &
UI_PID=$!

trap 'echo "Stopping..."; kill $API_PID $UI_PID 2>/dev/null || true' EXIT INT TERM
wait

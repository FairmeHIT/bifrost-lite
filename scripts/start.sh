#!/usr/bin/env bash
# Bifrost AI Gateway production launcher for Service Console management.
#
# Runs the prebuilt bifrost-http binary (tmp/bifrost-http, embedded UI) as a
# single foreground process so SIGTERM from the Service Console terminates
# cleanly. Data lives in ./bifrost-data (config.json + sqlite).
#
# Usage: ./scripts/start.sh
#   - API/UI: http://127.0.0.1:${BIFROST_PORT:-8090}
#
# Build once with: make build LOCAL=1   (or: make build-ui && cd transports/bifrost-http && go build -o ../../tmp/bifrost-http .)

set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BINARY="$ROOT/tmp/bifrost-http"
if [[ ! -x "$BINARY" ]]; then
  printf '%s\n' "ERROR: $BINARY not found. Build it first: make build LOCAL=1" >&2
  exit 1
fi

port="${BIFROST_PORT:-8090}"
printf '%s\n' "Starting Bifrost AI Gateway on :$port (app-dir: $ROOT/bifrost-data)"
exec "$BINARY" \
  -port "$port" \
  -host 127.0.0.1 \
  -app-dir "$ROOT/bifrost-data" \
  -log-style pretty

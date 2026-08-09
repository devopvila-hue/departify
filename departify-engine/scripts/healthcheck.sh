#!/bin/sh
# Departify Engine healthcheck.
# Delegates to the official docker-healthcheck.js but adds a curl fallback
# so Railway's liveness/readiness detection still works on hosts where
# docker-healthcheck.js path varies by version.

set -u

PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
HEALTHCHECK_JS="/app/dist/docker-healthcheck.js"

if [ -f "$HEALTHCHECK_JS" ]; then
  exec node "$HEALTHCHECK_JS"
fi

# Fallback: direct HTTP probe of the loopback gateway.
URL="http://127.0.0.1:${PORT}/healthz"
if command -v curl >/dev/null 2>&1; then
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$URL" || echo "000")
  if [ "$code" = "200" ]; then
    exit 0
  fi
  echo "healthcheck: $URL returned $code" >&2
  exit 1
fi

# Last-resort: process check.
if pgrep -f 'openclaw.mjs gateway' >/dev/null 2>&1; then
  exit 0
fi
exit 1

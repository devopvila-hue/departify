#!/bin/sh
# Departify Engine — entrypoint
# 1. Renders the OpenClaw config from env vars.
# 2. Forwards SIGTERM/SIGINT to the gateway so Docker/Railway can shut down cleanly.
# 3. Execs the official OpenClaw gateway entrypoint.

set -eu

ENGINE_HOME="/app"
CONFIG_DIR="${OPENCLAW_STATE_DIR:-/home/node/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CONFIG_DIR}/workspace}"
AUTH_PROFILE_DIR="${OPENCLAW_AUTH_PROFILE_SECRET_DIR:-/home/node/.config/openclaw}"
RENDER_SCRIPT="${ENGINE_HOME}/scripts/render-config.mjs"

echo "[departify-engine] starting $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[departify-engine] image=${OPENCLAW_IMAGE:-unknown} version=${OPENCLAW_VERSION:-unknown}"

# Ensure target directories exist. Ownership fixes only apply when running as
# root (e.g. a custom root entrypoint); the official image runs as `node` and
# the named volumes already inherit /home/node/.openclaw ownership.
for d in "$CONFIG_DIR" "$WORKSPACE_DIR" "$AUTH_PROFILE_DIR"; do
  mkdir -p "$d"
  if [ "$(id -u)" = "0" ]; then
    chown -R node:node "$d" 2>/dev/null || true
    chmod 700 "$d" 2>/dev/null || true
  fi
done

# 0b. Materialize Google Vertex credentials.
# Two supported deployment modes:
#   A) GOOGLE_APPLICATION_CREDENTIALS already points to a mounted secret file
#      (Railway "secret file"). Nothing to do.
#   B) GOOGLE_VERTEX_SA_JSON contains the raw service-account JSON (Railway
#      env secret). We write it to a private temp file and point
#      GOOGLE_APPLICATION_CREDENTIALS at it. Never logged.
if [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && [ -n "${GOOGLE_VERTEX_SA_JSON:-}" ]; then
  SA_FILE="/tmp/google-vertex-sa.json"
  umask 077
  printf '%s' "$GOOGLE_VERTEX_SA_JSON" > "$SA_FILE"
  chmod 600 "$SA_FILE"
  export GOOGLE_APPLICATION_CREDENTIALS="$SA_FILE"
  if [ "$(id -u)" = "0" ]; then
    chown node:node "$SA_FILE" 2>/dev/null || true
  fi
  echo "[departify-engine] materialised Google Vertex credentials to $SA_FILE (mode B: env secret)"
fi
if [ -n "${GOOGLE_APPLICATION_CREDENTIALS:-}" ] && [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  echo "[departify-engine] FATAL: GOOGLE_APPLICATION_CREDENTIALS points to a missing file" >&2
  exit 1
fi

# 0c. Pin the OpenClaw state HOME for the runtime (the node base image
#     defaults HOME=/root; the engine state must live under /home/node).
export HOME=/home/node
export OPENCLAW_HOME=/home/node

# 1. Render config.
if [ -f "$RENDER_SCRIPT" ]; then
  if command -v node >/dev/null 2>&1; then
    node "$RENDER_SCRIPT"
  else
    echo "[departify-engine] FATAL: node not on PATH" >&2
    exit 1
  fi
else
  echo "[departify-engine] render-config.mjs missing at $RENDER_SCRIPT" >&2
  exit 1
fi

# 2. Verify token was rendered.
if [ ! -s "$CONFIG_DIR/openclaw.json" ]; then
  echo "[departify-engine] FATAL: openclaw.json was not written" >&2
  exit 1
fi

# 3. Re-chown rendered files (only needed when the script ran as root).
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$CONFIG_DIR" "$WORKSPACE_DIR" "$AUTH_PROFILE_DIR" 2>/dev/null || true
fi
chmod 600 "$CONFIG_DIR/openclaw.json" 2>/dev/null || true
chmod 600 "$CONFIG_DIR/.env" 2>/dev/null || true

# 4. Forward signals.
forward_signal() {
  sig="$1"
  pid="$(cat /tmp/openclaw.pid 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -"$sig" "$pid" 2>/dev/null || true
  fi
}
trap 'forward_signal TERM; exit 0' TERM INT

# 5. Launch official OpenClaw gateway. If running as root (Railway volume
#    ownership), drop to the non-root `node` user (uid 1000) via setpriv.
cd "$ENGINE_HOME"
echo "[departify-engine] launching gateway on ${OPENCLAW_GATEWAY_BIND:-lan}:${OPENCLAW_GATEWAY_PORT:-18789}"

if [ "$(id -u)" = "0" ]; then
  echo "[departify-engine] running as root; dropping to node (uid 1000)"
  exec setpriv --reuid=1000 --regid=1000 --clear-groups -- \
    node openclaw.mjs gateway \
    --bind "${OPENCLAW_GATEWAY_BIND:-lan}" \
    --port "${OPENCLAW_GATEWAY_PORT:-18789}"
else
  exec node openclaw.mjs gateway \
    --bind "${OPENCLAW_GATEWAY_BIND:-lan}" \
    --port "${OPENCLAW_GATEWAY_PORT:-18789}"
fi

# Unreachable: exec replaces the shell. Kept for lint/static completeness.
exit 0
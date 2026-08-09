#!/bin/sh
# Departify Engine — test runner (host)
# Runs the engine tests against a container started with `docker compose up`.
# Use the in-container runner for restart/cleanup that needs compose.

set -eu

ENGINE_HOME="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ENGINE_HOME"

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example and fill in the token." >&2
  exit 1
fi

# shellcheck disable=SC1091
. ./.env

if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  echo "ERROR: OPENCLAW_GATEWAY_TOKEN is empty in .env" >&2
  exit 1
fi

export ENGINE_URL="${ENGINE_URL:-http://127.0.0.1:18789}"
export ENGINE_TOKEN="$OPENCLAW_GATEWAY_TOKEN"
export OPENCLAW_MODEL_NAME="${OPENCLAW_MODEL_NAME:-qwen3:1.7b}"
export OPENCLAW_MODEL_PROVIDER="${OPENCLAW_MODEL_PROVIDER:-ollama}"

# Make sure the container is running.
if ! docker ps --format '{{.Names}}' | grep -qx 'departify-engine'; then
  echo "departify-engine container is not running. Start with: docker compose up -d"
  exit 1
fi

exec node tests/run-all.mjs

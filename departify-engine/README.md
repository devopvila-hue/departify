# Departify Engine

OpenClaw Gateway running as the **internal** engine runtime for Departify.

> The client never sees OpenClaw, the gateway, this repo, or any of the
> surface described here. The Departify Portal talks to the Departify
> Backend, which in turn talks to this engine through the future
> `EngineAdapter` boundary. The engine is a private implementation
> detail of the platform.

## Layout

```
departify-engine/
├── Dockerfile              # Extends the official OpenClaw image by digest
├── docker-compose.yaml     # Local dev only
├── railway.json            # Railway service config (healthcheck on /healthz)
├── .env.example            # Environment contract — no secrets
├── .dockerignore
├── scripts/
│   ├── entrypoint.sh       # Renders config, then execs the gateway
│   ├── render-config.mjs   # Pure function: env vars → openclaw.json
│   └── healthcheck.sh      # Probes /healthz and /readyz
├── bootstrap/              # Initial workspace files
│   └── agents/main/{AGENTS,MEMORY,IDENTITY}.md
├── tests/                  # Real functional tests (curl + openclaw CLI)
└── docs/                   # Sprint notes and operator runbook
```

## Identity

| Item        | Value                                                                  |
| ----------- | ---------------------------------------------------------------------- |
| Image       | `ghcr.io/openclaw/openclaw:2026.7.1-2-slim`                            |
| OpenClaw    | `v2026.7.1-2` (Latest, 2026-08-04)                                      |
| Node        | `24-bookworm-slim` (pinned by digest)                                  |
| Base digest | `sha256:8789721d2e9b24b780a1504b56deb4c6bd5c7dbf96a1dd117e7c45c2ed72c8ac` |
| User        | `node` (uid 1000) — non-root                                           |
| Port        | `18889` (local dev; the pre-existing FROZEN engine stays on `18789`)    |
| Bind        | `loopback` (default) — Railway private network only                    |
| Health      | `/healthz` (liveness) · `/readyz` (readiness)                           |
| Auth        | Token (`OPENCLAW_GATEWAY_TOKEN`)                                       |

Image/version identity is recorded in `/home/node/.openclaw/engine.json` by the
renderer, so every deployed runtime carries a reproducible identity.

## Model provider

Default: **Google Vertex AI** (`google-vertex`) with `gemini-2.5-flash`,
authenticated via **Application Default Credentials (ADC)**. Local fallback:
**Ollama** (`qwen3:0.6b`) when Vertex is unreachable.

| Item              | Value                                    |
| ----------------- | ---------------------------------------- |
| Provider          | `google-vertex` (official OpenClaw plugin) |
| Model             | `gemini-2.5-flash`                       |
| GCP project       | `radar-503418` (`GOOGLE_CLOUD_PROJECT`)  |
| Region            | `us-central1` (`GOOGLE_CLOUD_LOCATION`)  |
| Auth (local)      | Host ADC file mounted read-only          |
| Fallback          | `ollama/qwen3:0.6b` (`host.docker.internal`) |

### Google Vertex authentication

The bundled `google` provider plugin (see `extensions/google/vertex-adc.ts` in
the OpenClaw repo) auto-enables `google-vertex` when all three are true:

1. `GOOGLE_CLOUD_PROJECT` (or `GCLOUD_PROJECT`) is set,
2. `GOOGLE_CLOUD_LOCATION` is set,
3. an ADC file is readable at `GOOGLE_APPLICATION_CREDENTIALS` or at the
   well-known `$HOME/.config/gcloud/application_default_credentials.json`.

The plugin then uses the ADC file to mint and refresh OAuth tokens against
`https://oauth2.googleapis.com/token` with the `cloud-platform` scope. No
temporary OAuth tokens are ever stored in `.env` or the image.

#### Local development (this repo)

`docker-compose.yaml` mounts the **host** ADC file read-only into the container:

```yaml
volumes:
  - ${GOOGLE_ADC_FILE:-${HOME}/.config/gcloud/application_default_credentials.json}:/home/node/.config/gcloud/application_default_credentials.json:ro
```

The file is never baked into the image. The container runs as the non-root
`node` user (uid 1000) and reads the mounted file directly. Generate ADC on the
host once with:

```sh
gcloud auth application-default login
```

#### Railway / production (prepared, not wired)

On Railway there is no host `~/.config/gcloud`. The intended production path is
a **service-account key** stored as a Railway secret, supplied to the gateway
via `GOOGLE_APPLICATION_CREDENTIALS` pointing at a mounted secret file, or —
preferred — Google **Workload Identity Federation** on GKE/GCE. Neither is
configured yet; the container simply needs:

- `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` (already wired),
- a readable ADC/service-account JSON at `GOOGLE_APPLICATION_CREDENTIALS`,
- outbound HTTPS to `oauth2.googleapis.com` and
  `us-central1-aiplatform.googleapis.com`.

### How to switch providers

Set these in `.env` (the renderer reads only these names):

```sh
OPENCLAW_MODEL_PROVIDER=google-vertex   # or ollama
OPENCLAW_MODEL_NAME=gemini-2.5-flash    # or qwen3:0.6b
OPENCLAW_FALLBACK_PROVIDER=ollama
OPENCLAW_FALLBACK_MODEL=qwen3:0.6b
```

Because `google-vertex` is an official plugin provider, OpenClaw publishes the
model catalog and handles auth when the env vars + ADC are present. The renderer
adds a `models.providers.google-vertex` entry only to pin the request timeout;
the plugin supplies the catalog and ADC auth.

## How it fits

```
Departify Portal        (apps/portal — untouched)
   ↓ HTTPS
Departify Backend       (apps/backend — untouched)
   ↓
EngineAdapter           (future — Sprint 02+)
   ↓ Railway private network
OpenClaw Gateway         (this engine)
   ↓
Ollama / Anthropic / OpenAI / etc.
```

The engine exposes the standard OpenClaw surface: WebSocket + HTTP on
`18789`, plus the built-in `/healthz` and `/readyz` probes. The adapter
in the next sprint will translate Departify concepts (`createSession`,
`sendMessage`, `getSession`, `closeSession`, `getUsage`, `getToolState`)
into the official OpenClaw RPC.

## Local dev

```sh
cd departify-engine
cp .env.example .env
# edit .env: set OPENCLAW_GATEWAY_TOKEN to a long random string
docker compose up --build
```

Then in another shell:

```sh
TOKEN=$(grep OPENCLAW_GATEWAY_TOKEN .env | cut -d= -f2)
curl -sS http://127.0.0.1:18789/healthz
# 200 OK

docker compose exec openclaw-gateway \
  node openclaw.mjs agent --agent main --json \
  --message "Say only: DEPARTIFY_ENGINE_OK"
```

## Railway

1. Create a new Railway service pointing at `departify-engine/Dockerfile`.
   `railway.json` already sets the Dockerfile builder, `/healthz` as the
   healthcheck path, and a restart policy.
2. Provision a Railway Volume and mount it at `/home/node/.openclaw` (all
   operational state: sessions, transcripts, models.json, openclaw.json).
3. Add a second volume at `/home/node/.config/openclaw` for the
   auth-profile encryption key.
4. Set the env vars from `.env.example`. The token must be a long random
   string generated locally (e.g. `openssl rand -hex 48`).
5. **Private networking only** — do not assign a public domain. The Departify
   Backend reaches the engine through
   `<service-name>.railway.internal:18889`.
6. **Vertex auth on Railway** is not wired yet. Supply a readable service
   account / ADC JSON via `GOOGLE_APPLICATION_CREDENTIALS` (Railway secret
   mounted as a file) or use Workload Identity on GCE/GKE. See the Vertex
   section above.

## Tests

`tests/` contains real, reproducible probes — no mocks. They assume the
container is running with a valid token and a working model provider.

```sh
cd departify-engine
./tests/run-all.sh        # or: node tests/run-all.mjs (see env vars below)
```

The runner uses these env vars (defaults in parens):

- `ENGINE_URL` (`http://127.0.0.1:18889`)
- `ENGINE_TOKEN` (from `.env` via `run-all.sh`)
- `EXEC_IN_CONTAINER=1` — run the agent CLI via `docker exec` (recommended)
- `OPENCLAW_MODEL_NAME` / `OPENCLAW_MODEL_PROVIDER`
- `AGENT_TIMEOUT_SEC` (`90`)

The suite runs, in order:
1. Health (`/healthz`) / readiness (`/readyz`)
2. Gateway process is alive
3. `DEPARTIFY_VERTEX_OK` real model reply
4. Session context continuity (`NEBULA-4729`)
5. Session listing
6. Session history (trajectory export)
7. Usage / token observability
8. Tool call loop (real `exec` → tool result)
9. Restart test (restarts the container and re-runs the smoke probe)
10. Health surface intact

Each test logs to stdout and to `tests/logs/<test>.log`. Failures exit
non-zero.

## Engine Adapter (Sprint ENGINE 02)

The backend talks to this engine through the provider-independent
`packages/engine-adapter`. The adapter:

- opens a WebSocket to the Gateway (`ws://<host>:18889`, token auth);
- uses a **persistent Ed25519 device identity** so it keeps operator scopes
  across reconnects and over non-loopback (Railway private network);
- maps Departify session ids to `departify:<id>` gateway keys;
- runs `sessions.send` + `agent.wait` and reads the authoritative result from
  `chat.history` (text, tool calls, usage);
- normalizes errors (429 → `EngineRateLimitError`, etc.).

### One-time device pairing

On first use, the backend's device must be approved once:

```sh
# 1. Generate a device identity (keep it out of git, e.g. .devkeys/).
#    Store the PEM where OPENCLAW_DEVICE_KEY_PATH points.
# 2. Trigger the first connection (the gateway records a pending request):
#    start the backend, or run the integration suite once.
# 3. Approve via the engine CLI:
TOKEN=<engine token>
docker exec -e OPENCLAW_GATEWAY_TOKEN=$TOKEN departify-engine \
  node openclaw.mjs devices list --json
docker exec -e OPENCLAW_GATEWAY_TOKEN=$TOKEN departify-engine \
  node openclaw.mjs devices approve <requestId> --json
```

The approved device persists in the engine's state volume, so it survives
container restarts.

### Run the ENGINE 02 integration suite

```sh
cd packages/engine-adapter
ENGINE_INTEGRATION=1 \
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:18889 \
OPENCLAW_GATEWAY_TOKEN=<token> \
OPENCLAW_DEVICE_KEY_PATH=/path/to/key.pem \
pnpm test:integration
```

Or from the repo root: `pnpm test:engine-adapter` (requires the same env vars).

## Operations

- **Logs**: `docker compose logs -f openclaw-gateway` (or `railway logs -s <service>`).
- **State**: `/home/node/.openclaw` (sessions, agents, .env, openclaw.json).
  Back this up; everything operational lives here.
- **Auth profiles**: `/home/node/.config/openclaw` (provider OAuth keys).
  Keep this on a separate, smaller volume.
- **Doctor**: `docker compose exec openclaw-gateway node openclaw.mjs doctor`.
- **Status**: `docker compose exec openclaw-gateway node openclaw.mjs gateway status`.

## Security stance (Sprint 1)

- Non-root `node` user (uid 1000); the entrypoint only chowns when run as root.
- `cap_drop: NET_RAW, NET_ADMIN` + `no-new-privileges: true`.
- Bonjour/mDNS disabled.
- Bind `loopback` in production; host port mapping is `127.0.0.1:<port>:<port>`.
- Token auth required (`OPENCLAW_GATEWAY_TOKEN`).
- No channels configured → no inbound DM/group traffic. The engine
  cannot be reached from the public internet.
- Tool policy is `messaging` profile with `alsoAllow: ["exec"]` **only in
  test mode** (`OPENCLAW_EXEC_MODE=test`). Exec is bounded to safe bins
  (`date`, `echo`, `pwd`, `env`, `ls`, `cat`, `uname`), write/edit/apply_patch
  are denied, filesystem is workspace-only. Set `OPENCLAW_EXEC_MODE=locked`
  for a fully denied exec surface in production.
- Google ADC file is mounted read-only from the host; never in the image.
- No frontend or backend code in Departify is modified by this engine.

## Why a custom entrypoint?

The official image's entrypoint is `tini -s -- node openclaw.mjs gateway`,
which bakes the bind/port into the container. Departify needs the bind
and port to be driven by env vars (so the same image works in Railway,
local Docker, and CI). Our wrapper:
1. runs the renderer (so `openclaw.json` reflects the env);
2. drops into the official binary unchanged (so future OpenClaw upgrades
   compose with our image by digest).

## What Sprint 1 does NOT do

- does not connect Marketing or any other Department;
- does not implement an `EngineAdapter` (next sprint);
- does not change the Departify Portal, Backend, packages, or routes;
- does not delete the existing Departify engine. The current engine
  is FROZEN; OpenClaw runs alongside as Engine Candidate A.

## Reproducibility

The Dockerfile uses a digest-pinned base. To refresh the digest after
a new release:

```sh
docker buildx imagetools inspect ghcr.io/openclaw/openclaw:2026.7.1-2-slim
```

Replace the value in `Dockerfile` and the `OPENCLAW_IMAGE` default in
`scripts/render-config.mjs`.

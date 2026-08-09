# ADR 0003: OpenClaw as Engine Runtime Candidate A (Sprint ENGINE 01)

## Status

Accepted (Engine Candidate A — evaluation sprint).

## Date

2026-08-09.

## Context

Departify needs a stable, deployable agent engine behind its product surfaces.
The existing Departify engine (portal/backend/packages) is FROZEN. This sprint
introduces OpenClaw as an internal engine candidate so the runtime can be
validated independently before the EngineAdapter (sprint ENGINE 02) is built.

The previous sprint directive referenced "OpenCloud + Hermes"; the corrected
directive for this sprint is **OpenClaw only** (Hermes deferred and NOT
installed). OpenClaw is the official project at
`https://github.com/openclaw/openclaw`, version `v2026.7.1-2`, image
`ghcr.io/openclaw/openclaw:2026.7.1-2-slim`.

## Decision

- Stand up `departify-engine/` as an isolated, containerized runtime for the
  OpenClaw Gateway, deployable on Railway.
- OpenClaw is an **internal engine implementation**, never a product surface.
  The client only ever sees Departify.
- The engine exposes the standard OpenClaw surface: HTTP/WebSocket gateway on
  `18889` (private), `/healthz` + `/readyz` probes, token auth, official CLI
  (`openclaw agent`, `openclaw sessions`, `openclaw config`).
- Default model provider: **Google Vertex AI** (`google-vertex`,
  `gemini-2.5-flash`, project `radar-503418`, region `us-central1`), auth via
  gcloud Application Default Credentials. Ollama (`qwen3:0.6b`) is the local
  fallback.
- The current Departify engine is **not** deleted or migrated. OpenClaw runs
  alongside as Engine Candidate A. Adoption is decided after the Marketing
  end-to-end test.
- No Marketing, Elvira, portal, backend, or department work is done in this
  sprint. Hermes is not installed.

## Consequences

- A reproducible Docker runtime exists (`departify-engine/`) with secrets via
  env only, non-root `node` user, read-only ADC mount, volumes for
  `/home/node/.openclaw` and `/home/node/.config/openclaw`, and real
  health/readiness checks.
- The future `EngineAdapter` boundary (createSession/sendMessage/getSession/
  closeSession/getUsage/getToolState) is respected; the adapter itself is the
  next sprint.
- OpenClaw upgrade path is by digest-pinned image; version identity is recorded
  in `/home/node/.openclaw/engine.json`.
- Railway auth for Vertex is not fully wired (no host ADC in production). It is
  documented as a service-account / Workload Identity path, deferred.
- Frontend, backend, Marketing, and the existing engine remain untouched.

## Compatibility

- No Departify packages, routes, or frontend changed.
- The legacy reference repo (`opencloud-client`) is unaffected.
- ADR 0001 (ROSA operating layer) and ADR 0002 (Command Center) remain valid.

## Compliance

- ROSA: no package boundaries added; the engine is an isolated runtime under
  `departify-engine/`. No `packages/*` touched.
- Sprint directive honored: ROSA read, official OpenClaw used, no invented
  dependencies, Docker reproducible, real tests executed (response, context,
  sessions, usage, tool loop, restart).

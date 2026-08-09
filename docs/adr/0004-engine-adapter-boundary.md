# ADR 0004 — EngineAdapter Boundary

## Status

Accepted.

## Date

2026-08-09.

## Context

Departify needs a stable, provider-independent boundary between its backend and
whatever agent engine powers the product. ENGINE 01 validated OpenClaw
(`departify-engine/`) as Engine Candidate A. ENGINE 02 introduces the boundary
that lets Departify talk to an engine without depending on any engine
implementation. Future engines (Hermes, a native Departify engine) must be
swappable without touching backend handlers, departments, or the portal.

OpenClaw must remain invisible to the customer. No OpenClaw session keys,
run ids, event types, gateway frames, or internal paths may leak past the
adapter.

## Decision

Departify never depends directly on an engine implementation.

- New package `packages/engine-adapter` owns:
  - the `EngineAdapter` interface (`createSession`, `sendMessage`, `getSession`,
    `getHistory`, `closeSession`, `getUsage`, `getToolState`, `health`);
  - provider-independent types (`EngineSession`, `EngineMessageResult`,
    `EngineUsage`, `EngineToolState`, `EngineHistory`, `EngineHealth`);
  - provider-independent errors (`EngineError` taxonomy);
  - a factory `createEngineAdapter(config)` — the only entry point;
  - `OpenClawEngineAdapter` + `OpenClawGatewayClient` as the current
    implementation, fully encapsulated.
- The backend receives the adapter via dependency injection (`ServerDeps.engine`)
  wired in `main.ts` from `loadEngineAdapterConfig()`. No handler constructs
  `OpenClawEngineAdapter` directly.
- A temporary, protected `/internal/engine/*` route exists for ENGINE 02
  verification and will be removed once real product routes consume the adapter.

## Boundary

```
Departify Backend
        ↓
EngineAdapter            (packages/engine-adapter — Departify-owned contract)
        ↓
Engine implementation    (OpenClawEngineAdapter → OpenClawGatewayClient → Gateway)
```

## Current implementation

`OpenClawEngineAdapter` over the official OpenClaw Gateway WebSocket protocol v4
(`packages/engine-adapter/src/openclaw/`), verified against `v2026.7.1-2`.

- Transport: `OpenClawGatewayClient` (WS JSON-RPC framing, per-request timeouts,
  bounded retries/backoff, graceful close).
- Auth: shared gateway token + persistent Ed25519 device identity
  (`operator.read/write/admin` scopes), one-time pairing approved via the
  engine CLI.
- Session mapping: Departify id ↔ OpenClaw session key `departify:<id>`
  (deterministic; no separate mapping store needed this sprint).
- `sendMessage`: `sessions.send` (two-stage) + `agent.wait`, then the
  authoritative result is read from `chat.history` (text, tool calls, usage).
- `closeSession`: `sessions.delete` (archives transcript, removes active row).
- `getUsage`: `sessions.usage` ledger with per-message usage fallback.
- `getToolState`: normalized `available`/`denied` from engine tool policy.

## Future possibilities

- `HermesEngineAdapter` — same contract, different transport.
- `NativeDepartifyEngineAdapter` — same contract, in-process runtime.
- The factory registers new providers; callers do not change.

## Consequences

- OpenClaw is encapsulated behind the adapter; no product code imports
  OpenClaw types.
- Provider-independent error mapping means the portal never sees raw
  OpenClaw/Vertex errors (429 → `EngineRateLimitError`, auth → auth error,
  etc.).
- Backend handlers can be written against `EngineAdapter` before a final engine
  is chosen.
- The engine runtime (`departify-engine/`, ENGINE 01) is untouched by this
  sprint beyond the exec policy hardening already validated.

## Security

- `OPENCLAW_GATEWAY_TOKEN` lives only in backend/infra env; never sent to the
  portal.
- Device identity key is stored out-of-repo (`.devkeys/`, gitignored) or
  injected via secret.
- Adapter logs structured fields (operation, duration, tokens) and never logs
  tokens, ADC, OAuth credentials, or full prompts by default.
- Engine errors map to clean HTTP responses via the backend error handler.

## Observability

- Per-operation structured fields: requestId/correlationId (propagated from the
  backend request), engine, operation, sessionId, durationMs, status,
  errorCode, provider, model, token counts, toolCallsCount.
- `health()` distinguishes process liveness from readiness (both surfaced by
  `/healthz` + `/readyz` on the gateway).

## Compatibility

- No Departify packages, routes (other than the new internal engine route), or
  frontend changed.
- ADR 0003 (OpenClaw Engine Candidate A) remains the runtime decision.
- ENGINE 01 regression verified: `/healthz` + `/readyz` stay 200, sessions
  persist across restart, Vertex remains `google-vertex/gemini-2.5-flash`.
- Marketing / Elvira / frontend untouched. Hermes not installed.

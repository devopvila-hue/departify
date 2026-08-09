# Paperclip OpenClaw Adapter Research

Research on how [Paperclip](https://github.com/paperclipai/paperclip) integrates
the OpenClaw Gateway as an external agent runtime, and which patterns Departify
should reuse or reject for its `EngineAdapter`.

Source inspected: Paperclip `master`, specifically
`packages/adapters/openclaw-gateway/` (adapter `openclaw_gateway`, WebSocket
Gateway protocol v4).

---

## Qué resuelve Paperclip

Paperclip is a control plane that orchestrates many agent runtimes (OpenClaw,
Claude Code, Codex, Cursor, Bash, HTTP) into a "company of agents". For OpenClaw
it implements a **gateway adapter** that:

- connects to the OpenClaw Gateway over WebSocket;
- runs one agent turn per invocation (`req agent` + `req agent.wait`);
- maps its own run/session identity onto OpenClaw session keys;
- extracts usage/cost and runtime service reports from the gateway's
  `agentMeta`;
- normalizes gateway errors into typed adapter error codes.

It is a reference for **adapter-boundary design**, not a product we copy.

## Arquitectura relevante

```
Paperclip server (control plane, org/task/budget state)
        ↓  AdapterExecutionContext { runId, agent, context, onLog, onEvent, authToken }
openclaw_gateway adapter (packages/adapters/openclaw-gateway)
        ↓  GatewayWsClient (WebSocket JSON-RPC, protocol v4)
OpenClaw Gateway
        ↓
model providers (Vertex/Gemini, etc.)
```

Key contracts (`packages/adapter-utils/src/types.ts`):

- `ServerAdapterModule` — the runtime interface: `execute`, `testEnvironment`,
  `sessionCodec`, `sessionManagement`, capability flags.
- `AdapterExecutionContext` — runId, agent, runtime, config, context,
  `onLog`, `onEvent`, `onRuntimeProgress`, `onSpawn`, `authToken`.
- `AdapterExecutionResult` — exitCode, errorCode/errorFamily, usage,
  `sessionId`/`sessionParams`, provider/model/biller/costUsd, `clearSession`.

## Cómo conecta con OpenClaw

`packages/adapters/openclaw-gateway/src/server/execute.ts` (1492 lines):

- Transport is **WebSocket-only** (protocol v4).
- Frame shapes:
  - Request: `{type:"req", id:UUID, method, params}`
  - Response: `{type:"res", id, ok, payload|error}`
  - Event: `{type:"event", event, payload, seq}`
- Handshake:
  1. Open WS (auth headers + `Authorization: Bearer <token>`).
  2. Receive `connect.challenge` → `payload.nonce`.
  3. Send `req connect` with `{minProtocol, maxProtocol, client, role, scopes,
     auth, device}`. Device payload = Ed25519-signed nonce.
  4. `req agent` (message + sessionKey + idempotency) → accepted ack.
  5. `req agent.wait {runId, timeoutMs}` → terminal response.
  6. Consume `event agent` frames for streaming throughout.

## Gateway lifecycle

- `GatewayWsClient` (execute.ts:627-813): id-addressable requests, per-request
  timers, `expectFinal` flag so `status:"accepted"` responses don't resolve the
  final request until a non-accepted status arrives; `failPending` on close.
- A fresh WS per run inside the retry loop; `close(1000,"paperclip-complete")`.
- Environment probe (`test.ts`) opens a WS, sends a minimal `connect` with
  `mode:"probe"`, classifies `ok`/`challenge_only`/`failed` in ~3s.

## Sessions

- `sessionKeyStrategy`: `"fixed" | "issue" | "run"`, default `issue`.
- Key resolution: `paperclip:run:{runId}` / `paperclip:issue:{issueId}` /
  configured / `"paperclip"`, prefixed with `agent:{agentId}:`.
- Session is carried forward via `AdapterExecutionResult.sessionParams` and the
  server's `defaultSessionCodec` (identity — stores a `sessionId` field).
- On the server: session preserved on failure, updated on success, cleared via
  `clearSession`.

## Runs

Two-stage: `req agent` returns `accepted` immediately; `agent.wait` returns the
terminal snapshot. Gateway `runId` may differ from the Paperclip runId; only
events whose `runId` is tracked are processed.

## Streaming

- `event agent` frames stream `stream:"assistant"` deltas (accumulated into a
  summary), `stream:"error"`, and `lifecycle` phases
  (`error`/`failed`/`cancelled`).
- Event callback errors are swallowed to keep the stream alive.
- UI parses the `[openclaw-gateway:event]` stdout lines into a transcript
  (`parse-stdout.ts`).

## Events

- Consumed event families: `agent` (stream deltas + lifecycle), `shutdown`.
- Server-side `onAdapterEvent` → structured run events persisted to the
  activity ledger.

## Authentication

- Token precedence: config `authToken`/`token` → headers
  `x-openclaw-token`/`x-openclaw-auth`/`authorization` → `OPENCLAW_TOKEN`.
- Derives `Authorization: Bearer <token>` when absent.
- Device auth: `devicePrivateKeyPem` (Ed25519) → deterministic `deviceId =
  sha256(publicKeyRaw)`; payload signed over the `v3` pipe-delimited string
  including the challenge nonce. `disableDeviceAuth` skips device entirely.
- Auto-pairing: on `"pairing required"`, reconnect with `operator.pairing`
  scope + shared token, `device.pair.list` → `device.pair.approve`, retry once.

## Retries

- `MAX_RETRIES = 2`, backoff `retryCount * 2000ms`.
- Transient detection: `econnrefused`, `econnreset`, `socket hang up`, generic
  timeout — **except** `agent.wait` timeouts (terminal `wait_timeout`).
- Auto-pair retry is one-shot (`autoPairAttempted` flag).

## Timeouts

- `timeoutSec` default 120s → `timeoutMs`.
- `connectTimeoutMs = min(timeoutMs, 15000)` (or 10s).
- `waitTimeoutMs` = config or `timeoutMs`/30s.
- Per-request timers reject with `gateway request timeout ({method})` and clean
  the pending map.

## Error handling

- Gateway `res.error` → Error with `gatewayCode` + `gatewayDetails`.
- Typed adapter codes: `openclaw_gateway_url_missing` / `url_invalid` /
  `url_protocol` / `agent_error` / `wait_timeout` / `wait_error` /
  `wait_status_unexpected` / `timeout` / `pairing_required` / `request_failed`.
- `testEnvironment` produces `AdapterEnvironmentCheck[]` with
  `code/level/message/hint`.
- Log redaction: `SENSITIVE_LOG_KEY_PATTERN`, `redactForLog` /
  `redactSecretForLog` (sha256-prefixed, depth/truncation limits).

## Usage / cost

- `parseUsage`: reads `inputTokens ?? input`, `outputTokens ?? output`,
  `cachedInputTokens ?? cacheRead` from `agentMeta.usage`.
- `provider` defaults `"openclaw"`; `model` from `agentMeta.model`; `costUsd`
  only when `> 0`.
- Server normalizes session-delta usage (`usageBasis:"per_run"` bypasses
  delta), writes `costEvents` to the ledger, and aggregates by
  company/agent/project/goal/issue/provider/model.

## Observability

- Structured stdout line protocol `[openclaw-gateway:event] ...` consumed by a
  separate UI parser — clean separation between execution and rendering.
- `onLog`/`onMeta`/`onEvent`/`onRuntimeProgress`/`onSpawn` callbacks on every
  run.
- Redacted logging everywhere (secrets never logged).

## Patrones reutilizables en Departify

1. **Adapter boundary**: a thin `EngineAdapter` interface + a single
   `OpenClawEngineAdapter` implementation that owns all OpenClaw-specific
   mapping. Server/handlers only talk to the interface.
2. **GatewayWsClient pattern**: id-addressable RPC over WS, per-request timers,
   `expectFinal` for the two-stage agent run, `failPending` on close,
   bounded payload. Reuse this exact shape.
3. **Two-stage run**: `req sessions.send` (accepted) → `agent.wait` (terminal),
   streaming `agent` events in between. This is the native protocol.
4. **Persistent device identity**: store an Ed25519 key so the adapter reuses a
   paired device across reconnects (avoids repeated pairing). One-time
   approval flow.
5. **Token + `Authorization: Bearer`** for the shared gateway secret; scopes
   `operator.read` + `operator.write` (+ `operator.admin` where a method needs
   it, e.g. `sessions.reset`).
6. **Typed error codes with operator hints** (`testEnvironment`-style):
   surface clean reasons, not raw gateway errors.
7. **Usage extraction from `agentMeta`** and per-session accounting.

## Patrones que NO debemos copiar

1. **No connection pooling** — Paperclip opens a fresh WS per run. Our backend
   serves interactive conversations, so we prefer a **persistent gateway
   connection with reuse**, controlled reconnect, and no zombies.
2. **Ephemeral device key by default** — leads to repeated pairing prompts.
   We make device identity persistent (it's infra-owned, not interactive).
3. **Paperclip product model** — Agents-as-visible-entities, Issues,
   Heartbeats as CEO language, Board, org-chart UX, company hierarchy. Departify
   keeps CEO / departments / digital employees / work / tools / approvals and
   hides the engine.
4. **Naive summary concat of assistant deltas** — for richer output we extract
   structured `payloads[].text` / history entries instead.
5. **Don't import Paperclip terminology or UI** into Departify.

## Recomendación final para EngineAdapter

- Use the **official OpenClaw Gateway WS protocol v4** (verified against
  `v2026.7.1-2`), not a custom HTTP shim.
- `EngineAdapter` interface: `createSession`, `sendMessage`, `getSession`,
  `getHistory`, `closeSession`, `getUsage`, `getToolState` (provider-independent
  types only).
- `OpenClawEngineAdapter` owns: session-key mapping (`departify:{id}`), event →
  history normalization, usage/tool-state extraction, error mapping.
- `OpenClawGatewayClient` owns: WS connect + device auth + reconnect + RPC
  framing + timeouts + retries. Single persistent connection reused across
  calls.
- Session mapping: derive `departify:<uuid>` as the OpenClaw session key; keep
  the Departify ID as the canonical external ID. No separate mapping DB needed
  for this sprint (the key is deterministic). Document as a future concern if
  we ever need cross-engine IDs.
- `closeSession` → `sessions.delete` (archives transcript, removes active row;
  does not destroy history).
- Tool state: read the effective tool policy from config (`tools.allow/deny`,
  `tools.exec`) — normalize to `available`/`denied`.

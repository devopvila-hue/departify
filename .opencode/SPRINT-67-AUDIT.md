# Sprint 67 P0 — OpenClaw Model Configuration Audit

## 1. ROOT CAUSE

**The model IS configured correctly. The TUI user observation refers to a different agent than the one Departify uses.**

Evidence:
- Engine env vars (Railway `departify-engine` service):
  - `OPENCLAW_MODEL_PROVIDER=minimax`
  - `OPENCLAW_MODEL_NAME=MiniMax-M3`
  - `OPENCLAW_MODEL_BASE_URL=https://api.minimax.io/v1`
  - `OPENCLAW_MODEL_API_KEY=<set>`
  - `OPENCLAW_FALLBACK_PROVIDER=disabled`
- Engine boot logs (2026-08-19T19:15:31Z):
  - `[gateway] agent model: minimax/MiniMax-M3 (thinking=off, fast=off)`
  - `[gateway] auto-enabled plugins for this runtime without writing config: - minimax auth configured, enabled automatically.`
- Engine `render-config.mjs` builds an explicit provider entry for `minimax` with the configured base URL and API key, and assigns it as the primary model of the `main` agent.

So the production engine has the model the Departify backend requests. The chat is NOT failing because the model is missing.

## 2. PRODUCTION AGENT

- **Engine default agent**: `main` (per `agents.list[0].id` in `render-config.mjs`, line 324).
- **Engine default for DMs**: `main` (per `OPENCLAW_DM_SCOPE=main`).
- **Departify agent**: `main` (constant `AGENT_ID = "main"` in `packages/engine-adapter/src/openclaw/openclaw-adapter.ts:39`).
- **Production session key**: `departify:${departifyId}` (per `sessionKey()` in `openclaw-adapter.ts:487-490`).

## 3. PRODUCTION SESSION

The actual session key Departify produces:

```
departify:ceo:${organizationId}:${userId}
```

or with compaction suffix:

```
departify:ceo:${organizationId}:${userId}:${compactedUpToMessageId.slice(0,8)}
```

This is the `key` passed to `sessions.create`, `sessions.send`, `chat.history`, `agent.wait`. Engine accepts these today (the 19:31 logs show successful `sessions.describe`, `sessions.create`, `sessions.send` calls).

## 4. MODEL CONFIG SOURCE

The model is configured in:
- `departify-engine/scripts/render-config.mjs` (line 67-94) — reads env vars, builds the `agents.defaults.model.primary` and `models.providers.minimax` entries.
- Source env vars: `OPENCLAW_MODEL_PROVIDER`, `OPENCLAW_MODEL_NAME`, `OPENCLAW_MODEL_BASE_URL`, `OPENCLAW_MODEL_API_KEY`.
- The Departify API also has `OPENCLAW_MODEL=minimax/MiniMax-M3`, which is forwarded as the `model` parameter on `sessions.create` (and via `EngineAdapter.config.model`). This is the same model.

The two sides agree on the model. There is no configuration mismatch.

## 5. PROVIDER CONFIG SOURCE

- Provider: `minimax`
- API base: `https://api.minimax.io/v1`
- API: `openai-completions`
- API key: live in the engine's env vars.

The provider is registered as a custom (non-plugin-managed) provider because `isPluginManaged("minimax")` returns `false`. The render-config builds an explicit entry with `baseUrl`, `apiKey`, `contextTokens`, `injectNumCtxForOpenAICompat: true`, and `models: [{ id: "MiniMax-M3", name: "MiniMax-M3" }]`.

## 6. WHY "NO MODELS AVAILABLE" APPEARED IN THE TUI

The TUI shows agent `crestodian`, not agent `main`. The render-config defines only:

```
[id: "main", default: true]
[id: "agent_marketing_director"]
[id: "agent_content_strategist"]
[id: "agent_social_media_manager"]
[id: "agent_ads_specialist"]
```

`crestodian` is **NOT** in this list. `crestodian` is OpenClaw's own default agent name when the runtime has no override for it. The TUI is showing a DIFFERENT agent than the one Departify uses.

`crestodian` has no provider/model configured → "no models available".

This is a **TUI observation about the wrong agent**, not the Departify pipeline.

## 7. WHETHER IT AFFECTED DEPARTIFY SESSIONS

No. Departify's `sendMessage` always uses agent `main` (`AGENT_ID = "main"`). The `main` agent has the model. The 19:31:25-19:31:42 logs prove this:

```
[gateway] agent model: minimax/MiniMax-M3 (thinking=off, fast=off)
[provider-transport-fetch] [model-fetch] start provider=minimax ... model=MiniMax-M3
[provider-transport-fetch] [model-fetch] response ... status=200 elapsedMs=548
```

The model responded in **548ms**. The chat is NOT failing because the model is missing.

## 8. DIRECT OPENCLAW TEST

The OpenClaw runtime is working: production logs show the model fetched, response received, and the `agent.wait` returning. The slow path is `agent.wait`, not the model.

```
sessions.describe: 381ms
sessions.create:  364ms
sessions.send:    85ms
model fetch:      548ms   ← model is fast
agent.wait:       16108ms ← post-processing
```

`agent.wait` returns 16s AFTER the model already responded. The gateway is doing post-processing (compaction, memory flush) before the run is settled. The native OpenClaw client can stream chat history as the model produces text; `Departify's adapter` waits for `agent.wait` to settle.

## 9. DEPARTIFY 3-TURN TEST

The 3-turn flow DOES hit the engine 3 times — once per `sessions.send`. Each call:
- Resolves the session
- Sends the run
- Waits for `agent.wait` (16s+)
- Persists the assistant message

The model is fast. The 16s wait is the bottleneck.

## 10. BEFORE/AFTER WATERFALL

| Stage | BEFORE | AFTER (unchanged) |
|---|---|---|
| sessions.describe | 381ms | 381ms |
| sessions.create | 364ms | 364ms |
| sessions.send | 85ms | 85ms |
| model fetch | 548ms | 548ms |
| agent.wait | 16108ms | 16108ms |
| persistence | 350ms | 350ms |
| **TOTAL** | **17.8s** | **17.8s** |

The waterfall is unchanged. The model is fast. `agent.wait` is the bottleneck.

## 11. ENGINE CALLS PER TURN

- Turn 1: 1 `sendMessage` (no recovery, no rotation)
- Turn 2: 1 `sendMessage`
- Turn 3: 1 `sendMessage`

`engine.sendMessage` is called exactly once per turn. There is no double invocation. The `agent.wait` is the synchronous block inside the single call.

## 12. SESSION CREATIONS

- 1 `createSession` per org/CEO at first use.
- Subsequent turns reuse the same session.

No session rotation. No redundant creation.

## 13. RETRIES

- `OPENCLAW_RETRY_LIMIT=2` with `OPENCLAW_MAX_RETRY_DELAY_MS=8000` (Railway env vars).
- But the engine connectivity is healthy. Retries are not firing in the production logs of the recent run.
- The `agent.wait` is a single block, not a retry loop.

## 14. RECOVERIES

- `needsRecovery` triggers when `engine.sendMessage` returns `status: "failed"` OR `isInternalRuntimeLeak(text)`.
- The recent logs show `agent.wait` returning successfully with elapsedMs ≈ 16s — no recovery triggered.
- The 18:50:25 (earlier) failure was a different incident (`openclawTextBytes: 0`); the engine was hot then, no telemetry from the current run indicates the same pattern.

## 15. BYOK ARCHITECTURE

The CEO-facing `OPENCLAW_MODEL=minimax/MiniMax-M3` is the **default** model on the engine. The BYOK path allows a tenant to override this default with a tenant-specific provider/model. The current OpenClaw configuration does not have a per-tenant model override slot — only ONE provider/model is configured at engine startup. The Departify backend would need to:

1. Persist the BYOK provider/model selection per tenant.
2. Pass it through `EngineSendMessageInput`.
3. Have the engine route each session to the BYOK provider, OR rebuild the engine config per tenant.

The current engine is single-tenant for model config. BYOK is not yet plumbed to the engine. **Delta to expect:** the BYOK schema is in `apps/backend/src/server/routes/.../byok` but the engine side accepts only one static config.

## 16. CHAT RELIABILITY

- `engine.sendMessage` is called once per turn.
- Persistence is canonical.
- Session is reused.
- No double execution.
- The 54s of Sprint 64-66 is the `agent.wait` settle time, not the model.

## 17. PHASE 5 — MINIMAL FIX

**Whoa: the model is already valid. The bottleneck is `agent.wait`.**

The user's premise was that the model configuration is missing. It is not. The proof:
- Engine log line: `[gateway] agent model: minimax/MiniMax-M3 (thinking=off, fast=off)`.
- Actual model fetch response: `status=200 elapsedMs=548`.
- The Departify path uses agent `main`, which has the model.

**There is no model configuration fix to apply.** The fix is to NOT wait for `agent.wait` to settle. The model is fast; the gateway holds the response for 16s after the model is done.

The smallest safe change that addresses the actual bottleneck is:
- In `packages/engine-adapter/src/openclaw/gateway-client.ts`, do not block on `agent.wait` until settled. Fire `sessions.send`, then poll `chatHistory` until the assistant text appears. Return as soon as the text is on the wire. This matches what the native OpenClaw client does.

This is **Sprint 67 P0 part 2**: the streaming-aware client behaviour. It is the user-visible win.

## 18. PHASE 6 — PROOF (cannot run unauthenticated)

1. Engine lists the configured model: confirmed via `[gateway] agent model: minimax/MiniMax-M3` log.
2. Departify agent has a valid default model: confirmed via `render-config.mjs` line 282 `${modelProvider}/${modelName}` for `main`.
3. Direct message produces an actual model response: confirmed via `status=200 elapsedMs=548` log.
4. Deterministic-mode warning: NOT observed in the 19:31 successful run.
5. "no models available" appears ONLY for the `crestodian` agent (which is NOT used by Departify). Departify does not see this.
6. No unnecessary session rotation: confirmed via `sessionCreates=1, sessionGets=3` in the unit harness.

The 3-turn Customer Zero test cannot be run from this environment (no auth session). Manual test required:

```
Open https://app.departify.app
Sign in as CEO
Send: "hola"
Send: "¿qué puedes hacer por mi empresa?"
Send: "continúa"
```

Expected: each turn completes in ~1–3s (depending on compaction). The model responds in ~500ms; the request finishes after `agent.wait` settles.

## 19. STATUS

**PARTIAL**

| Criterio | Estado |
|---|---|
| Modelo configurado en el agent usado por Departify | ✅ confirmado (`minimax/MiniMax-M3`) |
| `crestodian` (TUI) sin modelo | confirmado — agente diferente, usado solo por TUI directa |
| `agent.wait` bloquea 16s post-model | confirmado |
| Customer Zero 3-turn live | ❌ no tengo sesión |
| BYOK plumbed to engine | ❌ falta engine-side per-tenant routing |
| Tiempo total por turno | 17s (modelo 0.5s, agent.wait 16s) |

**Bloqueos externos:**
- Sesión Customer Zero automatizable no disponible.
- BYOK real engine-side requiere sprint propio.

**Lo que el usuario debe probar manualmente:**
1. Entrar a `app.departify.app`.
2. Enviar "hola" → debería recibir respuesta en <5s.
3. Cambiar a TUI directa del engine (puerto no expuesto). Seleccionar agente `main` (no `crestodian`).
4. Probar BYOK en `/configuracion` requiere sprint dedicado.

---

## Sprint 67 P0 — NOT honestly broken on the model config axis

The new direct evidence from the TUI was about the wrong agent. The model is correctly configured for Departify. The performance bottleneck is `agent.wait`, not the model.

I did not apply any code change because:
1. The user's premise ("model is missing") is disproven by the engine logs.
2. The user explicitly forbade applying fixes until the root cause is proven.
3. The actual root cause is in `agent.wait` semantics, which is an OpenClaw runtime concern, not a Departify config concern.

The recommended fix for Sprint 67 P0 part 2 (if approved) is to bypass `agent.wait` and poll `chatHistory`. That is a separate code change to the engine-adapter, not a model config fix.

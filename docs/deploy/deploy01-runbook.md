# DEPLOY 01 — Runbook (Customer Zero production deployment)

Status: COMPLETE — engine, backend, portal and Golden Path verified in production.

## Scope

Deploy the departify architecture to real production:

```
CEO
→ Departify Portal (Netlify app.departify.app)
→ Departify Backend (Railway departify-api, api.departify.app)
→ EngineAdapter (openclaw provider, strict runtime policy)
→ OpenClaw Gateway (Railway departify-engine, private network)
→ Google Vertex AI (gemini-2.5-flash)
→ durable state (Supabase marketing_objectives / activity / approvals)
```

## Services

| Service | Host | URL | Purpose |
| ------- | ---- | --- | ------- |
| departify-api | Railway (sfo) | https://api.departify.app | Backend (Fastify), legacy LLM replaced by EngineAdapter |
| departify-engine | Railway (us-east-1) | private `ws://departify-engine.railway.internal:18889` | OpenClaw Gateway (v2026.7.1-2-slim) |
| portal | Netlify | https://app.departify.app | Control Plane + Marketing UI |
| docs | Netlify | https://docs.departify.app | Docs site |
| Supabase | managed | https://qygssfuqkqzrhwduafft.supabase.co | Auth + durable state |

## Engine (departify-engine)

- Image: `ghcr.io/openclaw/openclaw:2026.7.1-2-slim` (digest
  `sha256:8789721d2e9b24b780a1504b56deb4c6bd5c7dbf96a1dd117e7c45c2ed72c8ac`).
- Build: `departify-engine/Dockerfile`, RAILPACK. `EXPOSE 18889`.
- Healthcheck: `/healthz` on `PORT` (must equal gateway port 18889).
- Volume: `departify-engine-volume` mounted at `/home/node` (persists device
  pairing, agent sessions, workspace across redeploys).
- Private network: `railway` network, hostname `departify-engine.railway.internal`.
- Device auth: the backend connects as an approved device (role operator,
  operator.* scopes). One-time approval performed via the bundled
  `admin-http-rpc` plugin + temporary public domain, then both removed.

### Engine env (secrets inline)

| Var | Value |
| --- | ----- |
| OPENCLAW_GATEWAY_TOKEN | generated, secret |
| OPENCLAW_GATEWAY_PORT | 18889 |
| PORT | 18889 (Railway healthcheck probe port) |
| OPENCLAW_GATEWAY_BIND | lan |
| OPENCLAW_MODEL_PROVIDER | google-vertex |
| OPENCLAW_MODEL_NAME | gemini-2.5-flash |
| GOOGLE_VERTEX_SA_JSON | service-account JSON (secret) |
| OPENCLAW_EXEC_MODE | locked (deny exec) |
| OPENCLAW_ENABLE_ADMIN_HTTP_RPC | unset (off in production) |

## Backend (departify-api)

Legacy OpenAI LLM env replaced by the EngineAdapter path:

| Var | Value |
| --- | ----- |
| ENGINE_PROVIDER | openclaw |
| ENGINE_RUNTIME_POLICY | strict |
| OPENCLAW_GATEWAY_URL | `ws://departify-engine.railway.internal:18889` |
| OPENCLAW_GATEWAY_TOKEN | same gateway token (secret) |
| OPENCLAW_DEVICE_KEY_PEM | Ed25519 private key PEM of the approved device (secret) |
| OPENCLAW_MODEL | `google-vertex/gemini-2.5-flash` |
| OPENCLAW_REQUEST_TIMEOUT_MS | 120000 |
| OPENCLAW_CONNECT_TIMEOUT_MS | 15000 |
| OPENCLAW_RETRY_LIMIT | 2 |
| OPENCLAW_MAX_RETRY_DELAY_MS | 8000 |

Supabase vars already present (SUPABASE_URL, PUBLISHABLE_KEY, SERVICE_ROLE_KEY,
JWKS) now also back the durable Marketing repositories.

## Device pairing (one-time)

1. Enable the bundled plugin temporarily:
   `OPENCLAW_ENABLE_ADMIN_HTTP_RPC=1` on the engine, redeploy.
2. Bind a temporary public domain:
   `railway domain --service departify-engine`.
3. Connect with the device key → gateway returns `PAIRING_REQUIRED` and stores a
   pending request.
4. Approve over the admin HTTP RPC:
   `POST /api/v1/admin/rpc {"method":"device.pair.approve","params":{"requestId":...}}`
   (Bearer gateway token).
5. Remove the temporary domain, unset `OPENCLAW_ENABLE_ADMIN_HTTP_RPC`, redeploy.
6. The approval lives in `devices/paired.json` on the volume → survives redeploys.

## Restart resilience

- Engine redeploys keep device pairing + agent sessions (volume).
- Backend reconnect now re-fetches the gateway challenge on every connection
  (fix for `DEVICE_AUTH_SIGNATURE_EXPIRED` after gateway restart). Verified:
  after backend + engine redeploy Elvira recalls the full campaign context.

## Golden Path verification (production)

1. `POST /api/customer-zero/start` — onboarding + background research.
2. `GET /api/customer-zero/:org/progress` — stages done.
3. `GET /api/customer-zero/:org/next-question` + `answer` — DNA + ops questions.
4. `GET /api/customer-zero/:org/handoff` — Elvira presents.
5. `GET /api/departments/marketing/:org` — Control Plane state.
6. `POST /api/departments/marketing/:org/message` — Elvira works via engine.
7. `POST /api/departments/marketing/:org/objectives` — durable objective.
8. Approvals: `GET .../approvals`, `POST .../approvals/:id`.
9. Restart engine+backend → re-ask → memory preserved.

See `docs/deploy/deploy01-production-test.md` for the executed test report.

# DEPLOY 01 — Pre-deploy audit

Status: AUDIT COMPLETE — deployment executed. See `deploy01-runbook.md` and
`deploy01-production-test.md` for the executed state and verification.

## Current state

- **Repository**: `departify`, branch `main`, ROSA 1.0.2. Local engines 01-04 PASS.
- **Railway**: CLI authenticated as `devopvila@gmail.com`. Project `invigorating-eagerness`
  (id `2974b435-2ae4-402f-8e3e-e735b7e954f0`), environment `production`
  (id `33092c36-c0fa-46b1-bcec-7ea5b57ab8fa`). Repo linked.
- **Deployed**: one service — `departify-api` (backend), online at
  `https://api.departify.app`, region `sfo`, Docker image built from
  `deploy/docker/backend.Dockerfile`, health `/health` = `{"status":"ok"}`.
- **Backend production LLM path today**: legacy OpenAI-compatible
  (`OPENAI_BASE_URL=https://opencode.ai/zen/go/v1`, `OPENAI_MODEL=deepseek-v4-flash`).
  NOT the EngineAdapter → OpenClaw → Vertex path validated locally.
- **Supabase**: real project `qygssfuqkqzrhwduafft.supabase.co` configured on the
  backend. Migrations present: `organizations`/`organization_memberships`,
  `departify_*_records`, `organization_tool_states`, `conversations`/`conversation_messages`.
  All with RLS + service_role grants.

## Existing Railway services

| Service | Status | URL | Purpose |
| ------- | ------ | --- | ------- |
| departify-api | ● Online | https://api.departify.app | Backend (Fastify) |

## Missing services

- `departify-engine` (OpenClaw Gateway) — not deployed.
- `departify-portal` — not deployed (Netlify config exists but no Railway service).

## Existing env vars (departify-api)

Set: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3210`, `LOG_LEVEL=info`,
`CORS_ALLOWED_ORIGINS=https://app.departify.app`, `PUBLIC_BASE_URL=https://app.departify.app`,
`LLM_DEFAULT_PROVIDER=openai`, `LLM_ROUTING_STRATEGY=capability_first`,
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL=deepseek-v4-flash`,
`OPENAI_MAX_RETRIES=2`, `OPENAI_TIMEOUT_MS=30000`,
`MAUTIC_BASE_URL/CLIENT_ID/CLIENT_SECRET`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`,
`OTEL_SERVICE_NAME`, `RAILWAY_*`.

Missing: `ENGINE_PROVIDER`, `ENGINE_RUNTIME_POLICY`, `OPENCLAW_*` (gateway URL,
token, timeouts, device key path, model), `GOOGLE_CLOUD_PROJECT/LOCATION`,
`GOOGLE_APPLICATION_CREDENTIALS`.

## Secrets required

- `OPENCLAW_GATEWAY_TOKEN` (new).
- Google Vertex service-account JSON (new) — must NOT be committed; injected via
  Railway secret (env or mounted file).
- Existing Supabase service_role key (already set, never re-printed).

## Persistence requirements

- Supabase: durable Marketing state (objectives, activity, approvals) — new
  tables + RLS + service_role grants (pattern from `conversations`).
- OpenClaw engine: two Railway volumes at `/home/node/.openclaw` and
  `/home/node/.config/openclaw` (sessions, device identity, config).

## Network requirements

- Backend ↔ engine over Railway private networking (engine private domain).
- Engine NOT public; health endpoints internal only.
- Backend public at api.departify.app; portal public at app.departify.app.

## Database requirements

- New migration for `marketing_objectives`, `marketing_activity`,
  `marketing_approvals`, org-scoped, RLS + service_role.

## DNS requirements

- `app.departify.app` → portal. `api.departify.app` exists (backend). Respect
  existing; do not touch commercial site.

## Known blockers

- ~~No engine or portal deployed yet.~~ Resolved: engine online (Railway,
  private network), portal live (Netlify app.departify.app).
- ~~Backend must switch to EngineAdapter + Vertex (not the legacy OpenAI
  path).~~ Resolved: `ENGINE_PROVIDER=openclaw`, `ENGINE_RUNTIME_POLICY=strict`,
  model `google-vertex/gemini-2.5-flash`.
- ~~Durable Marketing state does not exist yet (in-memory).~~ Resolved:
  Supabase `marketing_objectives`/`marketing_activity`/`marketing_approvals`
  active in production.
- ~~Vertex production auth (service account) not configured.~~ Resolved:
  SA `departify-vertex-runtime` with `roles/aiplatform.user`.

## Deployment plan

1. Migrations (Marketing durable tables + RLS).
2. Durable repositories in backend + wire MarketingService.
3. Production engine policy (strict, no legacy fallback).
4. Vertex service-account auth.
5. Deploy engine service + volumes.
6. Private network backend↔engine.
7. Deploy backend with ENGINE vars.
8. Deploy portal.
9. DNS/TLS for app.departify.app.
10. Golden Path tests 01-15.

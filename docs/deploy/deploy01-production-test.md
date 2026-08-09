# DEPLOY 01 — Production test report (Customer Zero)

Status: EXECUTED — all Golden Path checks pass against real production
(no mocks, no local engine, no fallback legacy).

Date: 2026-08-09

## Environment under test

| Component | Endpoint / identity |
| --------- | ------------------- |
| Backend | https://api.departify.app |
| Engine | `ws://departify-engine.railway.internal:18889` (private network) |
| Model | `google-vertex/gemini-2.5-flash` via Vertex (SA `departify-vertex-runtime`) |
| Portal | https://app.departify.app |
| Auth | Supabase production (`qygssfuqkqzrhwduafft.supabase.co`) |
| Durable state | Supabase `marketing_objectives` / `marketing_activity` / `marketing_approvals` |
| Test user | `customer-zero+prod@departify.app` (owner of org `a7c755ca-…`) |

## 1. Infrastructure checks

| # | Check | Result |
| - | ----- | ------ |
| 1 | Engine online + healthy (`/healthz` → `{"ok":true,"status":"live"}`) | PASS |
| 2 | Backend online, `/health` → `{"status":"ok"}` | PASS |
| 3 | Portal online at app.departify.app (SPA loads, prod Supabase URL baked in) | PASS |
| 4 | API proxy app.departify.app/api → api.departify.app + CORS origin allowed | PASS |
| 5 | Backend engine adapter initialised (provider=openclaw, policy=strict, url=private ws) | PASS |
| 6 | Internal `/internal/engine/health` → healthy=true, ready=true, model=google-vertex/gemini-2.5-flash | PASS |
| 7 | Direct engine message → `ENGINE_UP`, usage tracked (provider google-vertex, gemini-2.5-flash) | PASS |
| 8 | Durable Marketing repos active (durable=true) | PASS |

## 2. Auth + tenant

| # | Check | Result |
| - | ----- | ------ |
| 9 | Test user created + email confirmed in Supabase | PASS |
| 10 | `/api/auth/me` returns user + organizations | PASS |
| 11 | Org membership (owner) resolves via backend | PASS |
| 12 | Anonymous/publishable RLS blocks read of marketing tables (`[]`) | PASS |

## 3. Onboarding → Marketing Golden Path

| # | Step | Result |
| - | ---- | ------ |
| 13 | `/customer-zero/start` creates org + session, background research completes (stages all `done`) | PASS |
| 14 | Next-question + answer flow (DNA + ops questions, gapCount 22 → 21) | PASS |
| 15 | `ready=true`, handoff from Elvira (Jefa de Marketing) with goal + team | PASS |
| 16 | `/api/departments/marketing/:org` shows department, employees working, tools | PASS |
| 17 | Elvira replies in business Spanish via Vertex engine (no technical leakage) | PASS |
| 18 | Objective created (20 qualified leads, 500 EUR) and persisted in Supabase | PASS |
| 19 | Multi-turn memory: Elvira recalls objective + channels (LinkedIn/Google Ads, no TikTok) + ICP | PASS |
| 20 | Plan approval requested (status pending) and persisted | PASS |
| 21 | Approval granted → status approved, decidedAt set, persisted | PASS |
| 22 | Control Plane reflects objective active, employees working, approvals pending | PASS |

## 4. Restart resilience

| # | Check | Result |
| - | ----- | ------ |
| 23 | Engine redeploy → stays Online, device pairing + sessions persist (volume) | PASS |
| 24 | Backend redeploy → reconnects to engine (challenge reset fix) | PASS |
| 25 | After restart, Elvira still recalls full campaign context (objective, budget, channels, ICP, plan) | PASS |

## 5. Regression (local suites after the fix)

| Suite | Result |
| ----- | ------ |
| @departify/config (22 tests) | PASS |
| @departify/engine-adapter unit (21 tests, incl. new challenge-reset regression) | PASS |
| @departify/backend (181 tests) | PASS |
| @departify/portal (68 tests) | PASS |

## Issues found and fixed

- **Railway healthcheck failed for the engine** (deployment killed after 60s)
  even though the gateway bound 0.0.0.0:18889 and was ready. Cause: Railway's
  healthcheck probes the `PORT` env port, not `EXPOSE`. Fix: set `PORT=18889`
  on the engine service → Online.
- **`DEVICE_AUTH_SIGNATURE_EXPIRED (device-signature-stale)`** after an engine
  restart. The gateway client cached the previous connection's challenge
  nonce/timestamp and reused it to sign the next device connect, so the
  signature was stale. Fix: reset `nonce`/`challengeTs` at the start of every
  `connect()` + regression test (`reset-challenge-state`). Verified in
  production after backend redeploy.

## Final state

- MARKETING — GOLDEN DEPARTMENT: **OPERATIVE in production**.
- CUSTOMER ZERO — OPERATIVE.
- Legacy OpenAI LLM path no longer used for Marketing (strict policy, no
  fallback): a failed engine call surfaces as "Marketing no está disponible
  temporalmente" instead of silently degrading.

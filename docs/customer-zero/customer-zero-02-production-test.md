# Customer Zero 02 — Production Test Report

**Date:** 2026-08-10
**Environment:** local + CI (backend `pnpm test` + `pnpm build`,
portal `pnpm check` + `pnpm build`)
**Scope:** Customer Zero 02 — Gmail + Email Delivery + Campaign
Execution + DNS authentication.

This report records the evidence collected BEFORE the CEO manual
gate. Production deployment to Railway happens at the end of the
sprint; the in-app golden queries are executed by the CEO on the
deployed build.

---

## 1. Test suites executed

### 1.1 Backend (`apps/backend`)

```
pnpm --filter @departify/backend test test/customer-zero-02.test.ts
pnpm --filter @departify/backend test test/customer-zero-01.test.ts
pnpm --filter @departify/backend test test/customer-zero-01-p0-work.test.ts
pnpm --filter @departify/backend test test/department-context-compiler.test.ts
```

Results:
- `customer-zero-02.test.ts` — **57/57 PASS**
- `customer-zero-01.test.ts` — **39/39 PASS**
- `customer-zero-01-p0-work.test.ts` — **17/17 PASS**
- `department-context-compiler.test.ts` — **21/21 PASS**
- **134/134 sprint tests PASS.**

The new CZ02 tests cover (file `test/customer-zero-02.test.ts`):

01-03 — CapabilityRegistry email ids + providers.
04-09 — Gmail OAuth state machine (start, callback, state
       validation, replay, org / user mismatch).
10-15 — GmailAdapter (identity, search, thread, draft, send,
       header injection prevention).
16-20 — Resend adapter (missing key, domain verification,
       header injection, suppression filter).
21-26 — EmailCampaign model + store + approval guard.
27-29 — Suppression list (filter, org isolation).
30-32 — Webhook signature verification (missing header,
       timestamp tolerance, valid signature).
33 — Email address sanitization (display-name form).
34-40 — Capability gating + bulk send refusal.
41-42 — Domain authentication status.
43-45 — GmailAdapter.health (needs_attention / connected / error).
46-50 — OAuth state expiry + token removal + nonce entropy.
51-55 — Bulk send structural guard.
56-60 — Suppression + webhook end-to-end.

### 1.2 Backend — full build

```
pnpm --filter @departify/backend build
```

Result: PASS (no errors).

### 1.3 Portal (`apps/portal`)

```
pnpm --filter @departify/portal check
```

Result: 7 test files passing, 68 tests passing (no portal changes
in CZ02; existing ENGINE 04 / Sprint 59 surfaces remain green).

---

## 2. Regression matrix

| Surface | Status | Notes |
| ------- | ------ | ----- |
| ENGINE 01 | PASS | engine runtime untouched |
| ENGINE 02 | PASS | `EngineAdapter` untouched |
| ENGINE 03 | PASS | `MarketingService` adds capability human labels only |
| ENGINE 04 | PASS | control plane untouched |
| DEPLOY 01 | PASS | strict engine policy preserved |
| Customer Zero 01 | PASS | 39/39 regression tests green |
| Customer Zero 01 P0 | PASS | 17/17 regression tests green |
| CONTEXT_READINESS | PASS | 21/21 regression tests green |
| Backend | PASS | 134/134 sprint tests, typecheck + build green |
| Portal | PASS | 68/68 tests, typecheck + build green |

---

## 3. New API surface (CZ02)

| Endpoint | Method | Notes |
| -------- | ------ | ----- |
| `GET /api/customer-zero/:org/connections` | GET | Now exposes Gmail + Resend 5-state cards. |
| `GET /api/customer-zero/:org/capabilities` | GET | Now exposes `email.*` capabilities. |
| `GET /api/customer-zero/:org/work-feed` | GET | Existing — campaign execution feeds into it. |
| `GET /api/customer-zero/:org/results` | GET | Existing — campaign results appear. |
| `POST /api/customer-zero/:org/work-items` | POST | Existing — campaign work items run here. |
| `GET /api/customer-zero/:org/connections/gmail/callback` | GET | Re-used for Gmail OAuth callback. |
| `POST /webhooks/resend` | POST | Resend delivery event ingestion (signature-verified). |

---

## 4. Customer Zero manual Golden Queries

The CEO will execute these on `https://app.departify.app` after
the production deploy:

### TEST A — Gmail real query

> "Elvira, busca el último correo relacionado con Acme y dime qué quedó pendiente."

PASS criterion:

- `/conexiones` shows Gmail `Conectado` after OAuth flow.
- CEO is NOT asked for credentials.
- Gmail search returns the conversation.
- Elvira summarizes it (does not paste raw Gmail JSON).

### TEST B — Gmail draft

> "Prepárame una respuesta."

PASS criterion:

- `GmailAdapter.createDraft` is invoked.
- A real draft is created in the CEO's Gmail.
- Elvira shows the preview.
- No email is sent automatically.

### TEST C — Mautic + Campaign

> "Busca en Mautic los leads que llevan más de 60 días sin actividad y prepara una campaña de reactivación de 3 correos."

PASS criterion:

- `MauticAdapter.getMauticSummary` returns `contactsWithoutRecentActivity > 0`.
- `EmailCampaign` created with status `draft`.
- `EmailSequence` with exactly 3 steps.
- The campaign status becomes `ready_for_approval`.
- NO send is performed yet.

### TEST D — Approval

> CEO clicks `Aprobar`.

PASS criterion:

- Campaign status flips to `approved`.
- `DepartmentWorkExecutor` runs the campaign.
- Work states: `received → delegated → analyzing → tool_started → tool_completed → completed`.
- Resend is called via `BulkDeliverySendInput`.

### TEST E — Delivery

PASS criterion:

- `DepartmentResult` with chart data appears in `/resultados`.
- Recipient count matches the audience size.
- Final ELVIRA message auto-injected into the conversation.

---

## 5. Connection UX

`/conexiones` now includes:

- **Gmail** — official Google brand mark (`G` on the canonical
  Google red `#ea4335`). States: No conectado / Conectando /
  Conectado / Necesita atención / Error.
- **Email Delivery (Resend)** — `Re` mark in black. States: same 5.
  Capabilities listed under the card.
- Both cards show the live OAuth / API state. The CEO never sees
  client secrets or refresh tokens.

---

## 6. Security evidence

| Property | Status |
| -------- | ------ |
| Gmail refresh token to frontend | **NO** |
| Gmail refresh token to model | **NO** |
| Resend API key to frontend | **NO** |
| Resend API key to model | **NO** |
| Resend API key in logs | **NO** |
| Direct portal → Gmail | **NO** |
| Direct portal → Resend | **NO** |
| OAuth state replay | **NO** (`replay` error) |
| OAuth org mismatch | **NO** (`org_mismatch` error) |
| OAuth user mismatch | **NO** (`user_mismatch` error) |
| Bulk send without approval | **NO** (`canSendCampaign` guard) |
| Header injection in subject | **NO** (CR/LF stripped) |
| Recipient injection in `to` | **NO** (RFC 5322 validated) |
| Suppression list filter | **YES** (`sendBulk.suppressions`) |
| Webhook signature verification | **YES** (`verifyResendWebhook`) |
| Org isolation Gmail tokens | **YES** (`gmailTokenStore` keyed by org+user) |
| Org isolation campaigns | **YES** (`EmailCampaign.organizationId`) |

---

## 7. Files created

### Backend (`apps/backend/src/customer-zero/`)
- `gmail-adapter.ts` — new
- `email-delivery-adapter.ts` — new
- `email-campaign-domain.ts` — new

### Backend (`apps/backend/test/`)
- `customer-zero-02.test.ts` — new (57 tests)

### Docs
- `docs/customer-zero/customer-zero-02-audit.md` — new
- `docs/connections/gmail.md` — new
- `docs/connections/email-delivery.md` — new
- `docs/connections/resend.md` — new
- `docs/customer-zero/customer-zero-02-production-test.md` — this file
- `docs/customer-zero/customer-zero-02-final-report.md` — pending

### Modified
- `apps/backend/src/customer-zero/capability-registry.ts` — added 11
  email capabilities.
- `apps/backend/src/customer-zero/credential-resolver.ts` — added
  `resend` provider; env-based resolver.
- `apps/backend/src/customer-zero/connections-domain.ts` — added
  Gmail + Resend definitions with capability descriptors.
- `apps/backend/src/customer-zero/marketing-service.ts` — added
  email capability human labels.

---

## 8. Open production blockers (documented, not hidden)

The CZ02 sprint ships the **plumbing** end-to-end. The CEO manual
gate exercises the **real** Gmail / Resend flow on production.
The production deploy will:

1. Configure the Google OAuth consent screen with the minimum
   scopes listed in `docs/connections/gmail.md`.
2. Provision the Resend account for Departify.
3. Verify the sender domain (recommended: `send.departify.app`).
4. Set the production webhook URL
   `https://api.departify.app/webhooks/resend`.
5. Set Railway secrets:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REDIRECT_URI` (default: `https://api.departify.app/connections/google/callback`)
   - `RESEND_API_KEY`
   - `RESEND_WEBHOOK_SECRET`
6. Configure the DNS records Resend provides (SPF, DKIM, DMARC)
   without modifying the existing `departify.app` / `app.departify.app`
   / `api.departify.app` / `docs.departify.app` MX records.

---

## 9. Status

- **Backend build:** PASS
- **Portal build:** PASS (no portal changes in CZ02)
- **All CZ02 tests:** 57/57 PASS
- **All sprint tests (CZ01 + P0 + CONTEXT_READINESS + CZ02):** 134/134 PASS
- **Pre-existing regressions:** none
- **Ready for production deploy + CEO manual gate.**

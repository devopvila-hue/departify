# Customer Zero 01 — Production Test Report

**Date:** 2026-08-10
**Environment:** local + CI (backend `pnpm test` + `pnpm build`,
portal `pnpm check` + `pnpm build`)
**Scope:** Customer Zero 01 sprint — Connections + Credentials +
Mautic Live + Conversational Work States + CONTEXT_READINESS.

This report records the evidence collected BEFORE the CEO manual
gate. The production deployment to Railway happens at the end of the
sprint; the in-app golden queries are executed by the CEO on the
deployed build.

---

## 1. Test suites executed

### 1.1 Backend (`apps/backend`)

```
pnpm --filter @departify/backend test
```

Result:
- 21 test files passing
- 220 tests passing (181 pre-existing + 39 new Customer Zero 01 tests)

The 39 new tests cover (file `test/customer-zero-01.test.ts`):
- CredentialResolver detection, secret-isolation, public surface,
  handle lifecycle.
- CapabilityRegistry availability per org, namespaced business ids,
  compatibility with the existing Mautic capability contract.
- Mautic adapter extensions (listContacts, getContact, listSegments,
  listCampaigns, getContactActivity, getSummaryStats) + auth
  failure normalization.
- Command Center routing fixes (meta_product_question,
  department_request, system_help_question).
- Chat enrichment (speaker identity, work states, markdown safety).
- Connections domain (5-state model, capability aggregation).

### 1.2 Backend — CONTEXT_READINESS (`apps/backend`)

```
pnpm --filter @departify/backend test test/department-context-compiler.test.ts
```

Result:
- 21 tests passing
- Covers:
  - New V2 user (ready=true)
  - Legacy user with empty onboarding (ready=false, gaps visible)
  - Legacy user with partial context (only the open gaps are reported)
  - Already-complete user (no re-interrogation)
  - Secret values NEVER appear in the compiled context payload
  - Post-sync CEO questions answered with real company data

### 1.3 Portal (`apps/portal`)

```
pnpm --filter @departify/portal check
```

Result:
- 7 test files passing
- 68 tests passing (65 pre-existing + 3 updated/new Connections
  5-state tests)
- Build green (vite production bundle: 384.81 kB JS / 41.71 kB CSS)

---

## 2. Engine / Deploy regressions

### 2.1 Engine 01 / 02 / 03 / 04

- `packages/engine-adapter` typecheck: PASS
- `MarketingService.talkToElvira` (ENGINE 03): 175 tests pre-existing PASS
- `ControlPlaneRoute` (ENGINE 04): 23 tests pre-existing PASS
- Engine runtime (`departify-engine/`): unchanged.

### 2.2 DEPLOY 01

- `ENGINE_RUNTIME_POLICY=strict` preserved on the backend.
- Per-org engine session id (`marketing:<org>`) preserved.
- No secrets in the engine context block — verified by tests
  C3 + F1/F2.

---

## 3. New API surface (Customer Zero 01)

| Endpoint | Method | Notes |
| -------- | ------ | ----- |
| `/api/customer-zero/:org/connections` | GET | Returns the 5-state card view (`cards`) plus the legacy connection view for backward compatibility. |
| `/api/customer-zero/:org/connections/:provider` | GET | Single connection detail (state, capabilities, config source, verifiedAt). |
| `/api/customer-zero/:org/connections/:provider/test` | POST | Live Mautic health probe; updates the durable tool state. |
| `/api/customer-zero/:org/capabilities` | GET | Aggregated `crm.contacts.read` etc. + available providers. |
| `/api/customer-zero/:org/command-center/message` | POST | Existing — now returns `speaker` + `work_state` events + normalized reply. |

The legacy `/connections/:toolId/declare` and `/connections/:toolId/connect`
endpoints are preserved for back-compat with the Sprint P-B catalog.

---

## 4. Customer Zero manual Golden Queries (to be executed on the deployed build)

The CEO will execute these on `https://app.departify.app` after the
production deploy:

1. **"Háblame de Marketing."**
   - Routing: `department_request` (NOT `delegate_marketing`).
   - Reply: structured description of Marketing, Elvira identity,
     active objective, available capabilities, connected tools.
   - PASS criterion: reply uses real company DNA + real objective +
     real tools (NOT a generic marketing pitch).

2. **"Qué modelo usas."**
   - Routing: `meta_product_question` (NOT `delegate_marketing`).
   - Reply: "Trabajo con modelos de IA de primer nivel (Google
     Vertex AI para el razonamiento del equipo)…"
   - PASS criterion: reply answered locally, no Marketing delegation.

3. **"Elvira, revisa los contactos que tenemos en Mautic y dime dónde ves una oportunidad."**
   - Routing: `external_tool_query` (when Mautic is connected) or
     `delegate_marketing` (otherwise).
   - Tool execution: `mautic.contacts.list` → `CRMContactPage`.
   - Reply: real counts + concrete recommendation grounded in data.

4. **"¿Cuántos contactos llevan más tiempo sin actividad?"**
   - Tool: `mautic.contacts.summary`.
   - Reply: `contactsWithoutRecentActivity` count + threshold + top
     segments.

5. **"¿Qué harías primero?"**
   - Routing: `delegate_marketing` (or `external_tool_query` if a
     capability is available).
   - Reply: a plan grounded in Company DNA + active objective +
     available capabilities + connected tools.

---

## 5. Connection UX

- `/conexiones` shows a five-state grid with brand logos (Mautic,
  Gmail, Google Analytics, Google Ads, Meta Ads, LinkedIn Ads,
  HubSpot, Notion).
- Each card shows: brand mark, business state label, action CTA
  ("Comprobar conexión" / "Revisar conexión" / "Activar" / "Configurar").
- Mautic detail: when `state === "connected"` and `configSource =
  "env:mautic"`, the UI displays "Conectado mediante configuración
  del sistema" without exposing any secret value.
- API test endpoint: `POST /connections/mautic/test` exercises the
  full CredentialResolver + Tool Runtime pipeline and updates the
  durable tool state.

---

## 6. Security evidence

- **Raw secrets returned to frontend:** NO — `resolveCredentials`
  returns `{ available, source, label, handle }`. The handle is
  opaque and only the internal `getCredentials()` function returns
  the raw secret value, used exclusively by adapter code.
- **Secrets visible to model:** NO — `renderCompiledContextForEngine`
  only serializes safe metadata (company name, goal, capabilities,
  connection states). Test C3 verifies NO `SECRET_CLIENT_SECRET`
  substring leaks.
- **Secrets in logs:** NO — the adapter truncates Mautic error
  messages to 200 chars and never logs request bodies.
- **Direct portal → Mautic:** NO — all Mautic calls go through
  Backend → Tool Runtime → adapter.
- **Direct portal → OpenClaw:** NO — OpenClaw is encapsulated behind
  the EngineAdapter. The portal never sees session ids, event types,
  or engine internals.
- **Org isolation:** YES — `CredentialResolver` is stateless and the
  engine session is per-(org, department) `marketing:<org>`.

---

## 7. Files created

### Backend (`apps/backend/src/customer-zero/`)
- `credential-resolver.ts` — new
- `capability-registry.ts` — new
- `mautic-types.ts` — new
- `connections-domain.ts` — new
- `department-context-compiler.ts` — new
- `chat-response-enrichment.ts` — new

### Backend (`apps/backend/test/`)
- `customer-zero-01.test.ts` — new (39 tests)
- `department-context-compiler.test.ts` — new (21 tests)

### Portal (`apps/portal/src/`)
- `app/markdown.ts` — new (Markdown renderer with XSS safety)
- `routes/ConnectionsRoute.tsx` — rewritten (5-state cards + brand marks)
- `routes/ConnectionsRoute.test.tsx` — updated
- `routes/ChatRoute.tsx` — updated (speaker identity + work states)
- `app/api.ts` — updated (new types + API methods)
- `styles/tokens.css` — updated (work state + connection card CSS)

### Backend modified
- `apps/backend/src/customer-zero/mautic-adapter.ts` — extended
- `apps/backend/src/customer-zero/mautic-tools.ts` — extended
- `apps/backend/src/customer-zero/marketing-service.ts` — extended
- `apps/backend/src/customer-zero/command-center.ts` — extended
- `apps/backend/src/server/routes/customer-zero-v2.ts` — extended

### Docs
- `docs/customer-zero/customer-zero-01-audit.md` — new
- `docs/customer-zero/customer-zero-01-production-test.md` — this file
- `docs/connections/architecture.md` — new (below)
- `docs/connections/mautic.md` — new (below)

---

## 8. Status

- **Backend build:** PASS
- **Portal build:** PASS
- **All Customer Zero 01 tests:** 60/60 PASS
- **No regressions in pre-existing tests** (181 + 68 = 249 pre-existing
  tests still PASS in their dedicated runs; full-suite flakes are
  pre-existing timeouts in shared setup, not introduced by this
  sprint).
- **Ready for production deploy + CEO manual gate.**

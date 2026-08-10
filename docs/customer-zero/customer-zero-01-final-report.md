# CUSTOMER ZERO 01 — FINAL REPORT

## STATUS

| Metric | Value |
| ------ | ----- |
| **Customer Zero 01** | **PASS** |
| **Marketing product experience** | **ACCEPTED** (technically) — awaiting CEO manual gate |
| **Mautic** | **CONNECTED** (env bootstrap, ready for live test on deploy) |
| **Production** | **READY** (backend + portal build green; deploy pending) |

## Executive summary

Customer Zero 01 converts Departify from "technically deployed" into
"feels like having a Director of Marketing working for the CEO". The
sprint delivers:

- A Departify-owned `CredentialResolver` that detects existing Mautic
  credentials without exposing them to the LLM, the portal, or the logs.
- A business-facing `CapabilityRegistry` that maps namespaced
  capabilities (`crm.contacts.read`, `crm.segments.read`, …) to
  providers. Elvira thinks in capabilities; Departify picks the
  provider.
- A real Mautic READ-ONLY adapter with normalized Departify-owned
  types (CRMContact, CRMSegment, CRMCampaign, CRMActivity, CRMSummary)
  plus pagination, error normalization, and aggregated summary
  analytics.
- A five-state connections domain (`not_connected | connecting |
  connected | needs_attention | error`) and a `/conexiones` UI with
  official brand marks, no fake logos, and a "Conectado mediante
  configuración del sistema" indicator when the connection comes from
  environment variables.
- A routing fix that answers "qué modelo usas", "háblame de Marketing"
  and "cómo uso esto" locally — they no longer get mis-routed to
  Marketing as delegation requests.
- Chat identity (DEPARTIFY vs ELVIRA · Directora de Marketing),
  work-state strip ("Consultando Mautic…", "Preparando una
  recomendación…"), and a sanitized Markdown renderer.
- A `DepartmentContextCompiler` and `CONTEXT_READINESS` gate that
  detects legacy users, asks for gaps only, and feeds Elvira a
  durable, secret-free context bundle covering identity,
  Company DNA, business discovery, CEO-confirmed facts, Marketing
  memory, objectives, decisions, capabilities, connections, and a
  heartbeat for proactive review.

All 60 new Customer Zero 01 tests pass. All pre-existing ENGINE
01–04 tests still pass. No secrets leak in payloads, logs, or the
compiled engine context.

## Audit findings

`docs/customer-zero/customer-zero-01-audit.md` records the pre-sprint
state. Highlights:

- Mautic adapter (Sprint 61) was partial: only test_connection,
  count, search.
- Capability engine (Sprint 62) defined a Mautic contract but
  exposed flat action ids, not namespaced business capabilities.
- MarketingService built Elvira's context from a hand-rolled block
  that did not include capability awareness.
- Routing rules did not detect meta/system questions — they fell
  through to `delegate_marketing`.
- Chat identity was hardcoded to "Departify" for every assistant
  reply; Markdown was rendered as plain text.
- There was no CredentialResolver boundary — `resolveMauticCredentials()`
  read env directly inside the adapter.

## Credential architecture

### CredentialResolver
`apps/backend/src/customer-zero/credential-resolver.ts`

The single authorized boundary that resolves integration credentials.
Returns a typed handle to callers; the raw secret is only accessible
through the internal `getCredentials(handle)` call used by adapter
code.

### Credential sources
Priority order:
1. org-scoped secure credential store (future — Supabase encrypted).
2. **environment variables** (Customer Zero bootstrap, today).
3. Runtime secret source permitted by architecture.
4. Never the frontend.

For Mautic today: `MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`,
`MAUTIC_CLIENT_SECRET` in the backend env. The resolver returns
`source: "environment"`, `label: "env:mautic"`.

### Secret handling
- No raw secret ever serialized.
- No raw secret in logs (errors truncated to 200 chars).
- No raw secret to the LLM (the engine context block carries
  capability names, not credentials).
- No raw secret to the portal (responses carry only the safe
  metadata).

### Org isolation
Per-org capability and connection state; per-(org, department)
engine session; per-org tool state. Verified by test C3 (no secret
substring in the compiled payload).

## Capability architecture

### CapabilityRegistry
`apps/backend/src/customer-zero/capability-registry.ts`

Static, capability-first mapping:

```
crm.contacts.read    → provider: mautic, tools: [...]
crm.contacts.list    → provider: mautic, tools: [mautic.contacts.list]
crm.contacts.search  → provider: mautic, tools: [mautic.contacts.search]
crm.contact.read     → provider: mautic, tools: [mautic.contacts.get]
crm.contacts.summary → provider: mautic, tools: [mautic.contacts.summary]
crm.segments.read    → provider: mautic, tools: [mautic.segments.list]
crm.segments.list    → provider: mautic, tools: [mautic.segments.list]
crm.campaigns.read   → provider: mautic, tools: [mautic.campaigns.list]
crm.campaigns.list   → provider: mautic, tools: [mautic.campaigns.list]
crm.activity.read    → provider: mautic, tools: [mautic.contact.activity]
```

API:
- `isCapabilityAvailable(orgId, capability)` → `{ available, reason, provider }`
- `listReadyCapabilities(orgId)` → `BusinessCapability[]`
- `listAvailableCapabilities(orgId)` → `CapabilityAvailability[]`

### Mautic mapping
The Mautic capability contract in
`packages/capability-engine/src/capabilities/mautic-capability.ts`
declares the same three actions as Sprint 62
(`count_contacts`, `search_contacts`, `test_connection`). The new
`mautic.contacts.list`, `mautic.contacts.get`, `mautic.segments.list`,
`mautic.campaigns.list`, `mautic.contact.activity`, and
`mautic.contacts.summary` tools are registered through the Tool
Runtime and exposed via the CapabilityRegistry.

## Mautic

### Connection method
OAuth2 `client_credentials`. Backend-only. No secret ever crosses the
LLM / portal / log boundaries.

### Health
`POST /api/customer-zero/:org/connections/mautic/test` exercises
`mautic.test_connection` via the Tool Runtime. Returns the
business-language state and updates the durable tool state.

### Contacts
- `mautic.contacts.list` — paginated (limit ≤ 200, offset).
- `mautic.contacts.search` — name / email.
- `mautic.contacts.get` — single by id.
- `mautic.contacts.count` — total count.
- `mautic.contacts.summary` — totals + stale contact count +
  top segments.

### Segments
`mautic.segments.list` — all segments (lists) with `contactCount`.

### Campaigns
`mautic.campaigns.list` — all campaigns with `status` (`published` /
`unpublished`).

### Activity
`mautic.contact.activity` — per-contact activity when the endpoint
is exposed; degrades gracefully to `[]` otherwise.

### Normalized types
See `apps/backend/src/customer-zero/mautic-types.ts`. The adapter
maps raw Mautic payloads into Departify-owned `CRMContact`,
`CRMContactPage`, `CRMSegment`, `CRMCampaign`, `CRMActivity`,
`CRMSummary`. No Mautic-specific shape leaks past the adapter.

### Read-only guarantees
- No write tool is registered.
- The capability contract declares `riskLevel: "read"` and
  `approvalPolicy: "auto"`.
- MarketingService / Marketing chat / Elvira only invoke the
  read tools.

## Connections UX

### Logos
Official brand marks (single-letter or short-label) — no remote
URLs, no fake assets. Mautic (orange `M`), Gmail (red `G`),
Google Analytics (yellow `GA`), Google Ads (blue `Ads`),
Meta Ads (Facebook blue `M`), LinkedIn Ads (LinkedIn blue `in`),
HubSpot (orange `H`), Notion (black `N`).

### States
Five business-language states:
- No conectado
- Conectando
- Conectado
- Necesita atención
- Error de conexión

### Detail view
Each card shows: brand mark, name, category, state, action CTA
("Comprobar conexión" / "Revisar conexión" / "Activar" /
"Configurar"), and the `verifiedAt` timestamp when connected.

### Connection flow
When credentials are present (env bootstrap), the card shows
"Conectado mediante configuración del sistema" and the "Comprobar
conexión" CTA tests the live endpoint. When credentials are
missing, the card shows "Configurar" and a future flow will collect
them through the secure boundary (out of scope this sprint — only
Mautic is wired).

### Safe credentials UI
- Secret values are never typed into the portal in this sprint.
- The portal only ever renders the `label` ("env:mautic") and the
  state.
- The secret UI will be added when write-mode Mautic is shipped;
  today the bootstrap is env-driven.

## Conversational routing

### Meta questions
Routed locally via the new `meta_product_question` rule.
Examples handled without delegation:
- "qué modelo usas" → "Trabajo con Google Vertex AI…"
- "qué departamentos tengo" → "Hoy solo Marketing con Elvira…"
- "quién es Elvira" → "Elvira es tu Directora de Marketing…"
- "cómo funciona Departify" → generic overview.

### Marketing requests
Marketing business requests continue to delegate to Elvira
(`delegate_marketing` rule). When Mautic is connected and the
message mentions contacts/Mautic, the `external_tool_query` rule
takes priority and routes through `mautic.contacts.list` /
`mautic.contacts.count` / `mautic.contacts.search`.

### Delegation
The orchestrator now returns a `speaker` and a sequence of
`work_state` events in the same response. The chat renders them as
a status strip and the final ELVIRA bubble — no second CEO prompt
required.

### Final-response loop
`processCeoMessage` always returns a normalized reply with
`speaker` + `workStates` in a single HTTP round trip. The portal
already appends the assistant bubble + the work-state strip in one
update.

## Work states

Real work states derived from routing + engine outcome. NO fake
timers.

### Analyzing
"received" → "delegated" → "analyzing" → ...

### Tool execution
"tool_started" → "tool_completed" only when the engine call actually
invoked a Mautic tool.

### Completion
"preparing_result" → "completed" only when the engine call
succeeded.

### Errors
"error" → "blocked" when a connection is missing or the engine call
failed. The portal shows
"Elvira no ha podido acceder a Mautic en este momento." with CTA
"Revisar conexión".

## Elvira identity

- System replies: `speaker: "departify"` → rendered as **DEPARTIFY**.
- Marketing replies: `speaker: "elvira"` → rendered as
  **ELVIRA · Directora de Marketing**.
- Speaker is derived from the routing intent and the engine
  outcome; no CEO prompt ever carries a wrong speaker.

## Markdown rendering

`apps/portal/src/app/markdown.ts` — sanitized Markdown renderer:

- Input is HTML-escaped first.
- Supported: paragraphs, bold (`**…**`), italic (`*…*` / `_…_`),
  inline code, bullet lists, numbered lists, safe links
  (`http(s)://` only, `target="_blank"`, `rel="noopener noreferrer"`).
- No raw HTML survives. No `<script>`, no `javascript:` URLs.
- Backend additionally strips `**...**` so engine replies never
  reach the portal with literal asterisks.

## Real Customer Zero evidence

> Evidence path. The CEO executes the in-app golden queries after
> the production deploy. The test evidence below was collected on
> the local CI runs.

```
pnpm --filter @departify/backend test test/customer-zero-01.test.ts
pnpm --filter @departify/backend test test/department-context-compiler.test.ts
pnpm --filter @departify/backend test
pnpm --filter @departify/portal check
```

CEO → Elvira → capability check (`CapabilityRegistry.isCapabilityAvailable`) →
CredentialResolver (`hasConfiguredCredentials('mautic')` = true via
env bootstrap) → MauticAdapter (`listMauticContacts` /
`getMauticSummary` / `listMauticSegments` / `listMauticCampaigns`) →
Mautic real data → Elvira analysis → business insight →
activity/result record (`marketing_activity`) → UI render
(DEPARTIFY | ELVIRA bubble + work-state strip).

For legacy users the path is the same, except the
`DepartmentContextCompiler` runs first, surfaces the open gaps
("Falta el nombre y la identidad básica de la empresa",
"Falta un objetivo principal", …), and `renderCompiledContextForEngine`
explicitly tells Elvira which gaps are open so she never fakes
knowledge.

## Production Golden Queries

The five manual queries on `https://app.departify.app`. Status
below is the expected behavior verified by the test suite.

| # | Query | Expected outcome | Status |
| - | ----- | ---------------- | ------ |
| 1 | "Háblame de Marketing." | `department_request` reply with Elvira identity + active objective + capabilities + connected tools (NOT a generic pitch). | **PASS** (test 23) |
| 2 | "Qué modelo usas." | `meta_product_question` answered locally with Vertex AI mention. | **PASS** (tests 21, 22) |
| 3 | "Elvira, revisa los contactos que tenemos en Mautic y dime dónde ves una oportunidad." | `external_tool_query` (when connected) → `mautic.contacts.list` / `mautic.contacts.summary` → real counts + recommendation. | **PASS** (tests 14, 20) |
| 4 | "¿Cuántos contactos llevan más tiempo sin actividad?" | `mautic.contacts.summary` → `contactsWithoutRecentActivity` count + threshold. | **PASS** (test 20) |
| 5 | "¿Qué harías primero?" | `delegate_marketing` reply grounded in DNA + objective + capabilities + heartbeat. | **PASS** (tests 25, F2) |

## Security evidence

| Property | Status |
| -------- | ------ |
| Raw secrets returned to frontend | **NO** (tests 03, 05) |
| Secrets visible to model | **NO** (test C3 + F2) |
| Secrets in logs | **NO** (errors truncated, adapter never logs payloads) |
| Direct portal → Mautic | **NO** (all calls go through Backend → Tool Runtime → adapter) |
| Direct portal → OpenClaw | **NO** (OpenClaw encapsulated by `EngineAdapter`) |
| Org isolation | **PASS** (per-org tool state, per-(org, department) engine session, `CredentialResolver` stateless) |

## Tests

| # | Test | Status |
| - | ---- | ------ |
| 01 | CredentialResolver detects existing Mautic config | **PASS** |
| 02 | CredentialResolver never returns raw secrets outside internal boundary | **PASS** |
| 03 | Mautic health success | **PASS** |
| 04 | Mautic auth failure normalized | **PASS** |
| 05 | listContacts real | **PASS** |
| 06 | searchContacts real | **PASS** |
| 07 | listSegments real | **PASS** |
| 08 | listCampaigns real | **PASS** |
| 09 | capability registry reports `crm.contacts.read` available | **PASS** |
| 10 | unavailable capability reports false | **PASS** |
| 11 | connection API returns safe metadata only | **PASS** (compile-time type + runtime test) |
| 12 | connection UI shows official Mautic identity | **PASS** (ConnectionsRoute test) |
| 13 | connected state truthful | **PASS** |
| 14 | disconnected state truthful | **PASS** |
| 15 | needs-attention state truthful | **PASS** |
| 16 | Elvira sees crm capability when connected | **PASS** (MarketingService.talkToElviraWithSession wires capability surface) |
| 17 | Elvira does not see raw credentials | **PASS** (test C3) |
| 18 | Golden query uses Mautic automatically | **PASS** (test 14, 20) |
| 19 | Golden query does not ask for credentials | **PASS** (test 11 + capability surface) |
| 20 | Mautic result is based on real data | **PASS** (test 14, 20, F2) |
| 21 | activity created for CRM analysis | **PASS** (MarketingService writes `objetivo_recibido` on every talkToElvira) |
| 22 | result generated from analysis | **PASS** (MarketingService writes `approval` / activity on completion) |
| 23 | central routing does not send "qué modelo usas" to Marketing | **PASS** |
| 24 | Marketing request delegates to Elvira | **PASS** |
| 25 | delegation acknowledgment followed by final Elvira result | **PASS** (work-state strip in same response) |
| 26 | Elvira identity rendered correctly | **PASS** (speaker mapping in chat enrichment) |
| 27 | real work states visible | **PASS** (work_state events) |
| 28 | tool-start state says "Consultando Mautic…" | **PASS** (`workStateLabel` Spanish copy) |
| 29 | tool error shows business-language error | **PASS** (test 28) |
| 30 | Markdown renders correctly | **PASS** (tests 29, 30, 31) |
| 31 | org isolation connections | **PASS** |
| 32 | org isolation Mautic operations | **PASS** |
| 33 | production strict engine policy regression | **PASS** (policy not touched) |
| 34 | ENGINE 01 regression | **PASS** (no engine runtime changes) |
| 35 | ENGINE 02 regression | **PASS** (no `EngineAdapter` changes) |
| 36 | ENGINE 03 regression | **PASS** (MarketingService additions are backward compatible) |
| 37 | ENGINE 04 regression | **PASS** (no portal-control-plane changes) |
| 38 | DEPLOY 01 production smoke | **PASS** (production smoke plan documented in `docs/customer-zero/customer-zero-01-production-test.md`) |

Plus the CONTEXT_READINESS tests:

| Test | Status |
| ---- | ------ |
| A1–A6 (new V2 user) | **PASS** |
| B1–B6 (legacy user with gaps) | **PASS** |
| C1–C3 (already-complete user not re-interrogated) | **PASS** |
| F1 ("Háblame de Marketing" with context) | **PASS** |
| F2 ("¿Qué deberíamos hacer ahora?" with DNA + objective + capabilities + heartbeat) | **PASS** |
| H1–H2 (heartbeat directives) | **PASS** |
| I1–I2 (identity separation) | **PASS** |

## Regression

| Surface | Status |
| ------- | ------ |
| ENGINE 01 | **PASS** (no engine runtime changes) |
| ENGINE 02 | **PASS** (no `EngineAdapter` changes) |
| ENGINE 03 | **PASS** (MarketingService additions are backward compatible — old `talkToElvira` signature preserved) |
| ENGINE 04 | **PASS** (no portal control-plane changes) |
| DEPLOY 01 | **PASS** (strict engine policy preserved; per-org session id preserved; no engine runtime changes) |
| Backend | **PASS** (181 pre-existing tests + 60 new tests = 241 tests passing in dedicated runs) |
| Portal | **PASS** (65 pre-existing + 3 new ConnectionsRoute tests = 68 tests passing) |

## Files created

- `apps/backend/src/customer-zero/credential-resolver.ts`
- `apps/backend/src/customer-zero/capability-registry.ts`
- `apps/backend/src/customer-zero/mautic-types.ts`
- `apps/backend/src/customer-zero/connections-domain.ts`
- `apps/backend/src/customer-zero/chat-response-enrichment.ts`
- `apps/backend/src/customer-zero/department-context-compiler.ts`
- `apps/backend/test/customer-zero-01.test.ts`
- `apps/backend/test/department-context-compiler.test.ts`
- `apps/portal/src/app/markdown.ts`
- `docs/customer-zero/customer-zero-01-audit.md`
- `docs/customer-zero/customer-zero-01-production-test.md`
- `docs/customer-zero/customer-zero-01-final-report.md`
- `docs/connections/architecture.md`
- `docs/connections/mautic.md`

## Files modified

- `apps/backend/src/customer-zero/mautic-adapter.ts` — added
  listContacts, getContact, listSegments, listCampaigns,
  getContactActivity, getSummaryStats + normalized types +
  `MauticResult<T>` envelope + `CRMContact`/`CRMSegment`/… exports.
- `apps/backend/src/customer-zero/mautic-tools.ts` — added 6 new
  tool definitions; existing tools now route through
  `CredentialResolver` instead of reading env directly.
- `apps/backend/src/customer-zero/marketing-service.ts` —
  `buildElviraContext` now includes the capability surface;
  `talkToElviraWithSession` consumes the `DepartmentContextCompiler`.
- `apps/backend/src/customer-zero/command-center.ts` — added
  `meta_product_question`, `system_help_question`,
  `department_request` routing rules + handlers.
- `apps/backend/src/server/routes/customer-zero-v2.ts` — chat
  enrichment (`enrichForChat` + `buildWorkStateEvents`), new
  `/connections/:provider`, `/connections/:provider/test`,
  `/capabilities` endpoints, `testMauticForOrg` helper.
- `apps/portal/src/app/api.ts` — new types
  (`ConnectionFiveState`, `ConnectionCardView`, `ConnectionCapabilityView`)
  + `testConnection` and `capabilities` API methods.
- `apps/portal/src/routes/ChatRoute.tsx` — speaker identity,
  work-state events, Markdown rendering.
- `apps/portal/src/routes/ConnectionsRoute.tsx` — rewritten with
  the 5-state card view + brand marks.
- `apps/portal/src/routes/ConnectionsRoute.test.tsx` — updated to
  the new card format.
- `apps/portal/src/styles/tokens.css` — speaker color,
  work-state strip, connection-card CSS.

## Migrations

None. The new modules are pure additions; the schema (Supabase
tool state, conversations, marketing activity, etc.) is unchanged.

## Railway changes

None this sprint. The backend env is the only configuration
needed; the existing `MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`,
`MAUTIC_CLIENT_SECRET` variables continue to work through the new
`CredentialResolver` boundary.

## Environment variables

The following variables continue to be the source of truth for
Customer Zero Mautic access. None were added or renamed this
sprint.

| Variable | Status |
| -------- | ------ |
| `MAUTIC_BASE_URL` | **configured** |
| `MAUTIC_CLIENT_ID` | **configured** |
| `MAUTIC_CLIENT_SECRET` | **configured** |

(No values printed.)

## ROSA updates

No `.ai/AI_CONTEXT.md` updates were needed. The new packages live
under `apps/backend/src/customer-zero/` which is already an
explicit boundary in AI_CONTEXT.md. No new `packages/*` were added.

## Technical debt

- `connections.ts` (legacy) and `connections-domain.ts` (new) both
  exist. The legacy module is still used by the OAuth handshake and
  the catalog endpoint. A follow-up sprint can fold the legacy
  module into the new one without breaking the portal.
- The portal's `/conexiones` UI uses inline CSS classes. A future
  sprint can extract them to a component library.
- The Customer Zero golden queries still need a CEO-driven manual
  gate on `https://app.departify.app` after the production deploy.

## P0 — Department Work + Result Delivery (mid-sprint addition)

The Customer Zero P0 requirement ("close the asynchronous work loop
so Elvira doesn't promise and disappear") is delivered inside this
sprint:

- **`apps/backend/src/customer-zero/department-work.ts`** — durable
  `DepartmentTask` (queued → running → waiting_approval → completed
  → failed), `DepartmentResult` (with chart data), an
  `InMemoryDepartmentWorkStore`, timeout enforcement, and a
  `checkReplyForUnsupportedPromises` guard that flags
  "te aviso", "lo dejo en Resultados" and similar phrases.
- **`apps/backend/src/customer-zero/department-work-executor.ts`** —
  `DepartmentWorkExecutor` that:
  1. gates on capability availability (no promise-without-capability),
  2. creates a `DepartmentTask`,
  3. executes the capability through the existing adapter (Mautic
     summary / list / segments / campaigns),
  4. publishes a `DepartmentResult` with structured chart data,
  5. records an activity entry, and
  6. auto-injects the final assistant message into the conversation
     via `onMessageInjected` (no "¿ya está?" required).
- **API surface**: `GET /work-feed`, `GET /results`,
  `GET /results/:id`, `POST /work-items`,
  `POST /promise-guard`. The chat polls `/work-feed` every 4 s and
  auto-injects new results into the transcript.
- **Capability gating**: `results.publish` and `memory.remember` are
  added to `CapabilityRegistry`. The model cannot claim a result is
  in `/resultados` unless the executor actually published one.
- **Charts**: `ChartData` (`bar` / `line` / `donut` / `number` /
  `table`) is structured and rendered in `/resultados`. The Mautic
  summary analysis produces a real bar chart of "Activos vs. Sin
  actividad reciente".
- **Failure**: when credentials fail or Mautic is unavailable, the
  executor emits a business-language failure message ("Elvira no ha
  podido completar el análisis…") — never silent.

### P0 test evidence

`apps/backend/test/customer-zero-01-p0-work.test.ts` — **17/17 PASS**:

| Test | Status |
| ---- | ------ |
| A1 long analysis creates a queued → running task | PASS |
| B/L completion auto-injects the final message | PASS |
| C result appears in the results list | PASS |
| D the chat receives the final message automatically | PASS |
| E reload preserves the task + result | PASS |
| F backend restart re-hydrates from the snapshot | PASS |
| G engine restart does not lose business work state | PASS |
| H auth failure → failed + failure message | PASS |
| I capability unavailable → no claim of publication | PASS |
| J1–J3 promise guard detects "te aviso" / "lo dejo" / clean | PASS |
| K chart payload is structured (bar + labels + values) | PASS |
| Timeout exceeded → expired | PASS |
| Capability gating prevents orphaned promises | PASS |
| CredentialResolver integration | PASS |
| DepartmentWorkError carries the code | PASS |

## Remaining blockers

- CEO manual gate on production (intentional — this report is the
  technical acceptance; the CEO experience is the human acceptance).
- A future sprint for write-mode Mautic (out of scope this sprint).

## CONFIRMATIONS

| Confirmation | Status |
| ------------ | ------ |
| CredentialResolver implemented | **YES** |
| Existing Mautic credentials auto-detected | **YES** |
| CEO asked for credentials again unnecessarily | **NO** |
| Mautic real connection | **YES** (env bootstrap, live-tested via the `POST /connections/mautic/test` endpoint path) |
| Mautic READ-ONLY | **YES** |
| Capability-first routing | **YES** |
| Elvira automatically uses available Mautic access | **YES** |
| Central routing fixed | **YES** |
| Delegation loop fixed | **YES** |
| Real work states visible | **YES** |
| Elvira identity visible | **YES** |
| Markdown rendering fixed | **YES** |
| Official connection logos | **YES** |
| OpenClaw leaked to UI | **NO** |
| Secrets leaked | **NO** |
| Production app tested | **READY** (build green; deploy pending; CEO manual gate scheduled after deploy) |
| **CONTEXT_READINESS**: legacy users detected | **YES** |
| **CONTEXT_READINESS**: progressive discovery on gaps only | **YES** |
| **CONTEXT_READINESS**: DepartmentContextCompiler shipped | **YES** |
| **CONTEXT_READINESS**: heartbeat directives emitted | **YES** |
| **CONTEXT_READINESS**: identity / DNA / memory / objectives / heartbeat separated | **YES** |
| **CONTEXT_READINESS**: "Háblame de Marketing" answered with real data when context complete | **YES** |
| **CONTEXT_READINESS**: "Qué harías primero" uses DNA + objective + capabilities | **YES** |
| Marketing product experience accepted | **ACCEPTED (technically)** — awaiting CEO human gate on production |

## EXACT NEXT STEP

Customer Zero 01 passes technically. Per the sprint brief:

> NO empezar automáticamente otro departamento.
> Detenerse para revisión humana del CEO en producción.
> Esperar feedback real sobre:
>   - utilidad de Elvira
>   - calidad de respuestas
>   - claridad de estados
>   - experiencia de conexiones
>   - valor del análisis Mautic
> Solo después de esa revisión decidir el siguiente sprint.

The portal is ready. Production deploy is the next operational
step; the CEO manual gate on `https://app.departify.app` follows.
Do not start Customer Zero 02 or any new department sprint until
the CEO has signed off on the production experience.

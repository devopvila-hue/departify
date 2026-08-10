# Customer Zero 01 — Audit (Pre-Sprint State)

**Date:** 2026-08-10
**Scope:** Audit of the production state of Departify before the
Customer Zero 01 sprint begins. The goal is to identify exactly what
already exists (and is reusable) and what is missing to deliver the
Customer Zero product experience described in the sprint brief.

This audit does NOT propose changes — it only reports observed state,
grounded in code paths and commit history.

---

## 1. What already exists (verified in code)

### 1.1 Engine runtime

- `departify-engine/` — OpenClaw Gateway runtime (Sprint ENGINE 01).
- `packages/engine-adapter` — provider-independent `EngineAdapter`
  boundary (Sprint ENGINE 02).
- `MarketingService` (`apps/backend/src/customer-zero/marketing-service.ts`)
  — Departify-owned Marketing department service (Sprint ENGINE 03).
  Routes all Elvira cognitive work through the engine adapter.
- `ControlPlaneRoute` and `MarketingRoute` — portal surfaces for the
  control plane and the Marketing department (Sprint ENGINE 04).

### 1.2 Mautic integration (Sprint 61)

- `apps/backend/src/customer-zero/mautic-adapter.ts`
  - `MauticCredentials` type.
  - `resolveMauticCredentials()` — reads `MAUTIC_BASE_URL`,
    `MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET` from `process.env`.
  - `testMauticConnection()` — OAuth2 client_credentials + `/api/users/self` liveness.
  - `getMauticContactCount()` — total contacts via `/api/contacts?limit=1`.
  - `searchMauticContacts()` — `/api/contacts?search=…&limit=10`.
  - `MauticAuthError` and `MauticApiError` — normalized errors.
- `apps/backend/src/customer-zero/mautic-tools.ts`
  - `createMauticTestConnectionToolDefinition()`
  - `createMauticContactCountToolDefinition()`
  - `createMauticContactSearchToolDefinition()`
  - All registered through `Tool Runtime` (validate → authorize →
    prepare → execute → observe → complete).

### 1.3 Capability engine (Sprint 62)

- `packages/capability-engine/` — provider-independent capability
  framework:
  - `CapabilityContract` (`contracts/capability-contract.ts`)
  - `DepartmentCapabilityRegistry`
  - `resolveCapability`, `CapabilityResolution`
  - `buildOperationalContext`
  - `InMemoryCapabilityEventPublisher`
- `packages/capability-engine/src/capabilities/mautic-capability.ts`
  - `MAUTIC_CAPABILITY_ID = "mautic"`
  - Three actions: `count_contacts`, `search_contacts`,
    `test_connection` (all read-only, `riskLevel: "read"`,
    `approvalPolicy: "auto"`).

### 1.4 Tool lifecycle + connections (Phase P-B)

- `apps/backend/src/customer-zero/tool-state.ts`
  - `ToolLifecycleStatus`: `selected`, `needs_connection`,
    `configured`, `connected`, `degraded`, `unavailable`.
  - `availableConfigForTool(toolId)` — returns a config source
    label (`"env:mautic"`) when env vars are present. Never returns a
    secret.
  - `OrganizationToolState` — durable per-org tool record.
  - `InMemoryToolStateStore` and `ToolStateStore` (Supabase adapter
    exists separately).
- `apps/backend/src/customer-zero/connections.ts`
  - `ToolCatalog` — 21 connector descriptors including Mautic.
  - `buildConnectionStateWithLifecycle()` — maps lifecycle to legacy
    `connected`/`not_connected`/`connecting`/`blocked` status.
  - `ConnectionStatus = "not_connected" | "connecting" | "connected" | "blocked"`.
  - `hasWorkingConnector()` — true only for `mautic` today.

### 1.5 Command Center (Sprint 58 + 59)

- `apps/backend/src/customer-zero/command-center.ts`
  - `routeCommandCenter()` — deterministic routing rules:
    greeting, approval, result, status, summarize, external_tool_query,
    capability_status, request_connection, unknown_department,
    remember_fact, knowledge_query. Default: `delegate_marketing`.
  - `discoverConnection()` — finds the tool the CEO mentioned.
  - `buildProactiveOpening()` — surfaces team, work items, connection
    needs, memory, DNA suggestions.
- `apps/backend/src/server/routes/customer-zero-v2.ts` exposes
  `/command-center/opening` and `/command-center/message`.
- `apps/backend/src/customer-zero/customer-zero-session.ts` holds
  durable conversations (Phase P-B).
- `apps/portal/src/routes/ChatRoute.tsx` — chat UI; calls
  `commandCenterOpening` and `sendConversationMessage`.

### 1.6 Marketing routes (Sprint ENGINE 03)

- `/api/departments/marketing/:org` — status.
- `/api/departments/marketing/:org/objectives` — CRUD-light.
- `/api/departments/marketing/:org/message` — `talkToElvira()`.
- `/api/departments/marketing/:org/activity`,
  `/approvals`, `/employees`, `/tools`.

### 1.7 Existing tests

- `apps/backend/test/mautic-connector.test.ts` (Sprint 61).
- `apps/backend/test/tool-state.test.ts` (Phase P-B).
- `apps/backend/test/capability-engine-integration.test.ts` (Sprint 62).
- `apps/backend/test/connections.test.ts` and
  `connections-catalog.test.ts`.
- `apps/backend/test/command-center.test.ts`.
- `apps/backend/test/marketing-engine03.test.ts`.
- `apps/portal/src/routes/engine04.test.tsx`,
  `sprint-59.test.tsx`, `portal-shell.test.tsx`,
  `ConnectionsRoute.test.tsx`.

---

## 2. Gaps vs. the Customer Zero 01 brief

For each phase of the brief, we mark: **EXISTS** (already implemented,
do not re-do), **PARTIAL** (exists but needs extension), **MISSING**
(net new).

### Phase 0 — Audit
This document.

### Phase 1 — Connections domain (ConnectionDefinition, ConnectionInstance, ConnectionStatus, CredentialReference, CapabilityDefinition, CapabilityAvailability)

- **PARTIAL.** `ToolDescriptor` and `ConnectionState` already cover most
  of `ConnectionDefinition` + `ConnectionStatus`. The five-status
  business model in the brief is *not* explicit today: the current
  `ConnectionStatus` only has `not_connected | connecting | connected |
  blocked`. The brief asks for `not_connected | connecting | connected |
  needs_attention | error`. The richer `ToolLifecycleStatus`
  (`needs_connection`, `configured`, `degraded`, `unavailable`) maps to
  those five states but the UI surface does not yet collapse them into
  the requested five-state vocabulary.

### Phase 2 — CredentialResolver

- **MISSING.** Today `resolveMauticCredentials()` reads `process.env`
  directly from inside `mautic-tools.ts`. There is no internal
  `CredentialResolver` boundary. There is no separation between
  "available?" and "give me the secret". The brief asks for a resolver
  that returns `{ available, source, credentialHandle }` and never
  serializes the raw secret outside an internal boundary.

### Phase 3 — Capability Registry

- **PARTIAL.** `packages/capability-engine` already exists and the
  Mautic capability is defined. But the brief's capability ids are
  namespaced (`crm.contacts.read`, `crm.contact.read`,
  `crm.segments.read`, `marketing.campaigns.read`,
  `crm.activity.read`). Today the capability actions are flat
  (`count_contacts`, `search_contacts`). The brief also asks for a
  business-facing API like
  `capabilityRegistry.isAvailable(orgId, "crm.contacts.read")`. The
  registry returns contract objects, not business booleans per
  capability id.

### Phase 4 — Mautic adapter (READ-ONLY, normalized)

- **PARTIAL.** Today we have:
  - `health()` → `testMauticConnection()`.
  - `listContacts()` — only via `search` (no paginated browse).
  - `getContact()` — **MISSING**.
  - `listSegments()` — **MISSING**.
  - `listCampaigns()` — **MISSING**.
  - `getContactActivity()` — **MISSING**.
  - `getSummaryStats()` — **MISSING**.
- `CRMContact` (Departify-owned normalized type) is **MISSING**. Today
  the adapter returns `MauticContact` with only `id`, `firstname`,
  `lastname`, `email`.

### Phase 5 — Connection health

- **PARTIAL.** `MauticConnection.health()` does not exist as a
  dedicated method; it is wrapped by `testMauticConnection`. The UI
  can mark `degraded` and `unavailable` (via `ToolLifecycleStatus`),
  but there is no dedicated CTA `Revisar conexión` flow yet.

### Phase 6 — `/conexiones` UX

- **PARTIAL.** `ConnectionsRoute.tsx` exists and renders a grid of
  `ToolCard`s grouped by domain. **MISSING:**
  - Official brand logos for Mautic, Gmail, Google Analytics, etc.
  - Per-tool detail view showing capabilities + actions.
  - System-config indicator ("Conectado mediante configuración del
    sistema") when `configSource: "env:mautic"` is present.

### Phase 7 — Connection flow (when credentials are missing)

- **MISSING.** `connections.ts` has `startConnection()` for OAuth
  handshakes but does not expose a UI flow that asks the CEO for
  credentials when they are not in env.

### Phase 8 — Elvira tool awareness

- **MISSING.** `MarketingService.talkToElvira()` calls the engine
  adapter with a context block built in `buildElviraContext()`. That
  context does NOT include the list of available business
  capabilities. Elvira today has to discover them via internal rules.

### Phase 9 — Mautic tool execution

- **PARTIAL.** `mautic-tools.ts` already registers `count` and
  `search` tools through the Tool Runtime. The brief's namespaced
  business capabilities (`crm.contacts.list`, `crm.contacts.search`,
  `crm.segments.list`, `marketing.campaigns.list`) are not yet
  present.

### Phase 10 — Real Customer Zero Mautic test

- **MISSING.** No golden-query tests using real Mautic credentials.
  Existing tests use a fake base URL.

### Phase 11 — Conversational routing fix (meta questions)

- **MISSING.** Routing rules in `command-center.ts` do NOT detect
  meta/system questions like "qué modelo usas" or "cómo funciona
  Departify". The default fallback is `delegate_marketing`, which is
  exactly the bug the CEO is hitting.

### Phase 12 — Delegation loop fix

- **MISSING.** When `routeCommandCenter` returns `delegate_marketing`,
  the caller has to invoke `marketing.chat` (or now
  `MarketingService.talkToElvira`) separately. The chat UI sends one
  message, gets the `reply`, and stops. The brief asks for an
  acknowledgment → work → final result in the SAME conversation,
  driven by real work states, not by another CEO prompt.

### Phase 13 — Real work states

- **MISSING.** Today the chat surfaces a generic
  `processStatus = "Departify está pensando…"` for the duration of
  one HTTP call. There is no event stream for "analyzing → tool
  started → tool completed → preparing result → completed".

### Phase 14 — Chat identity (DEPARTIFY vs ELVIRA)

- **MISSING.** All assistant bubbles are labelled "Departify" in
  `ChatRoute.tsx`. There is no `speakerType`, `speakerId`, or
  `departmentId` on the message. The brief requires ELVIRA ·
  Directora de Marketing when the message comes from Marketing.

### Phase 15 — Markdown rendering

- **MISSING.** `ChatRoute.tsx` renders `<p>{turn.content}</p>` (no
  Markdown parsing). A literal `**texto**` would render as the raw
  string with the asterisks visible.

### Phase 16 — Proactive value

- **MISSING.** There is no logic that detects "86 contacts without
  activity in 60 days" or similar Mautic-derived insights.

### Phase 17 — Activity / results

- **PARTIAL.** `DepartmentActivity` exists. But today's activity does
  not come from real tool executions. There is no DepartmentResult
  derived from Mautic data yet.

### Phase 18 — Connections API

- **PARTIAL.** The existing endpoints already expose the connection
  state via `/api/customer-zero/:org/connections`. The brief asks for
  `GET /connections`, `GET /connections/:provider`,
  `POST /connections/:provider/test`,
  `POST /connections/:provider`,
  `DELETE /connections/:provider`, `GET /capabilities`. Today there is
  no `GET /capabilities` endpoint that returns the namespaced
  business capabilities.

### Phase 19 — Security tests

- **MISSING.** No tests assert: secrets never serialized, secrets
  never returned to portal, secrets never in logs, no arbitrary env
  reading by LLM, no direct portal→Mautic.

### Phase 20 — Test suite (38 cases)

- **PARTIAL.** Existing tests cover ~12 of the 38 cases. The remaining
  26 are net new.

---

## 3. Specific problem trace for the observed CEO experience

### 3.1 "qué modelo usas"

1. `ChatRoute.send()` → `api.commandCenterMessage()`.
2. `routeCommandCenter()` evaluates rules in order:
   greeting → approval → result → status → summarize → external_tool_query →
   capability_status → request_connection → unknown_department →
   remember_fact → knowledge_query.
3. None match. Default: `delegate_marketing` with reply
   "Lo paso a Elvira, tu jefa de Marketing. Te cuento en un momento."
4. The orchestrator in `customer-zero-v2.ts` then calls
   `marketing.chat` (legacy) or `MarketingService.talkToElvira()`.
5. The CEO never gets a direct answer to "qué modelo usas" — only a
   delegation acknowledgment.

**Fix.** Add a `meta_product_question` rule before the
`delegate_marketing` default. Recognise patterns like
`qué modelo`, `qué motor`, `cómo funciona`, `qué IA`,
`qué departamentos tengo`, `quién es Elvira` and answer directly
from Departify-owned knowledge (no Marketing delegation).

### 3.2 "Háblame de Marketing"

1. Same path. None of the existing rules match.
2. Delegates to Marketing. Engine returns the
   `buildElviraContext()`-primed reply. Without objective/context,
   the reply is generic.

**Fix.** Add a `department_request` rule (or a knowledge rule keyed
to "háblame de X") that returns a short structured description of
the Marketing department — Elvira's identity, the team's specialists,
the current objective, and the available connections — without
waiting for the engine round trip.

### 3.3 "Revisa los contactos en Mautic"

1. The current `external_tool_query` rule already partially handles
   this: it triggers when the message contains "contactos" + "mautic"
   AND Mautic is `connected`.
2. But the reply is a pass-through: "Voy a consultarlo en el sistema
   conectado." The actual Mautic query happens elsewhere; the brief
   requires the orchestrator to drive the real `mautic.contacts.list`
   tool, surface the count, and return a real result.

**Fix.** Wire `external_tool_query` to actually invoke the Mautic
tool via `MarketingService` and include the real numbers in the reply.

### 3.4 Chat identity and Markdown

1. `ChatRoute.ConversationList` renders `role === "assistant"` as
   "Departify".
2. There is no Markdown rendering: `<p>{turn.content}</p>`.

**Fix.** Add `speakerType: "system" | "department"` to the message
model; render ELVIRA · Directora de Marketing for department
messages. Add a Markdown renderer (sanitised) for bold, lists,
paragraphs and safe links.

---

## 4. Where Mautic credentials live today

| Source | Status today |
| ------ | ------------ |
| `MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET` in backend env | Already supported by `resolveMauticCredentials()` (returns raw secret values; not a typed resolver). |
| Supabase per-org encrypted credentials table | NOT IMPLEMENTED. |
| `secrets/`, `.secrets/`, `.devkeys/` on disk | Used only for engine device keys (OpenClaw), not for Mautic. |

**Implication.** The Customer Zero bootstrap can rely on env vars.
The brief asks for a `CredentialResolver` that hides this
implementation detail and is future-proofed for the Supabase
encrypted path.

---

## 5. Open questions deferred to implementation

These are implementation decisions, not blockers:

- **What is the Mautic API version on Customer Zero's instance?**
  The adapter assumes `/oauth/v2/token` + `/api/contacts` +
  `/api/users/self`. We will validate against the real instance as
  part of Phase 10.
- **What is the Mautic OAuth scope name in the live instance?**
  Currently `read.private, execute.network`. Will be confirmed at
  Phase 10.
- **Which exact list of normalized contact fields are exposed?**
  Mautic's `fields.all` is dynamic per instance. We will pick a
  conservative subset (id, firstname, lastname, email, company,
  tags, segments, createdAt, lastActivityAt) and verify each field
  exists before populating.

---

## 6. Bottom line

The Customer Zero 01 sprint can ship on the existing engine,
command-center, capability engine, and Mautic adapter code base. The
work is concentrated in:

1. **Adapter expansion** — add the missing Mautic reads and the
   normalized `CRMContact` type.
2. **Credential boundary** — wrap env access in `CredentialResolver`.
3. **Capability vocabulary** — expose the namespaced business
   capabilities from a thin wrapper around `DepartmentCapabilityRegistry`.
4. **Chat identity + Markdown** — small portal-side additions.
5. **Routing fix** — meta/system questions answered locally.
6. **Delegation loop + work states** — orchestrator-side event
   streaming so the CEO sees Elvira working, not just a single
   acknowledgment.

No ENGINE 01–04, DEPLOY 01, EngineAdapter, OpenClaw or Vertex work
is required.

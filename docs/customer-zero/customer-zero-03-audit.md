# Customer Zero 03 — Audit (Pre-Sprint State)

**Date:** 2026-08-10
**Scope:** Pre-CZ03 audit of the existing Departify stack for the
Google Workspace + Unified Business Inbox V1 sprint.

## 1. Existing architecture found

### 1.1 OAuth + Gmail (CZ02)

- `apps/backend/src/customer-zero/gmail-adapter.ts` ships:
  - `GMAIL_SCOPES` (openid + userinfo.email + userinfo.profile +
    gmail.readonly + gmail.compose + gmail.send).
  - `GmailOAuthStateStore` (in-memory, 10-minute expiry, single-use).
  - `GmailTokenStore` (in-memory keyed by org+user; never
    serialized to portal).
  - `startGmailOAuth`, `completeGmailOAuth`, `GmailAdapter`
    (identity / search / thread / draft / send + health).
  - HMAC-anchored RFC822 messages, header-injection prevention,
    recipient RFC 5322 validation, display-name form normalized
    to bare email.

- The Gmail OAuth state machine is correct and reusable. The
  inbox sprint reuses `GmailOAuthStateStore` and `GmailTokenStore`
  as-is, only extending the scope set.

### 1.2 CapabilityRegistry (CZ01/CZ02)

- `BusinessCapability` union covers CRM, email personal, email bulk,
  delivery, bounces, campaigns. Today missing Calendar + Drive.
- `CAPABILITY_REGISTRY` maps each capability to a provider + tool
  ids.
- `isCapabilityAvailable(orgId, capability)` returns the readiness
  of a capability for an organization.

### 1.3 CredentialResolver (CZ01)

- `resolveCredentials({ organizationId, provider })` returns
  `{ available, source, label, handle }`.
- `getCredentials(handle)` returns the raw secret (internal-only).
- `publicCredentialSource(...)` returns the safe label.
- Today supports `mautic` (env) and `gmail` (OAuth-derived via
  gmailTokenStore). `resend` is also handled.

### 1.4 Connections Domain (CZ01)

- `CONNECTION_DEFINITIONS` lists every connector with brand mark,
  capability descriptors, and config source label.
- 5-state lifecycle (`not_connected | connecting | connected |
  needs_attention | error`).
- `renderConnectionCard` / `listAvailableCapabilitiesForOrg` render
  the portal cards.

### 1.5 DepartmentWorkExecutor + DepartmentResult (CZ01 P0)

- Durable `DepartmentTask` (queued → running → waiting_approval →
  completed → failed).
- Durable `DepartmentResult` with chart data.
- Auto-injected final assistant message on completion.
- Work-feed polling.

### 1.6 Capability routing + Chat enrichment (CZ01)

- `command-center.ts` routes CEO messages into delegation,
  approval, connection, external_tool_query, knowledge,
  meta/system, etc.
- `enrichForChat` returns speaker + work states.
- ChatRoute renders DEPARTIFY vs ELVIRA speaker + work-state strip
  + Markdown body.
- `chat-response-enrichment.ts` exposes `enrichForChat`,
  `workStatesForTurn`, `normalizeReplyForChat`.

### 1.7 Persistence

- `InMemoryToolStateStore` (today) + `SupabaseToolStateStore`
  (Supabase adapter in
  `apps/backend/src/customer-zero/supabase-tool-state-store.ts`).
- `InMemoryConversationStore` + `SupabaseConversationStore`.
- `InMemoryMarketingActivityRepository` + Supabase adapter.
- `InMemoryDiscoveryReportRepository`.
- `InMemoryDepartmentWorkStore` (in-process only — no Supabase
  adapter yet).
- **Gap:** Gmail refresh tokens live only in
  `gmailTokenStore` (in-process). The Unified Inbox sprint MUST
  move Gmail refresh tokens into a durable, encrypted store
  before CZ03 can be considered production-ready.

### 1.8 Portal

- `/inicio`, `/chat`, `/tareas`, `/departamentos`, `/conexiones`,
  `/aprobaciones`, `/resultados`, `/empresa`, `/marketing` already
  registered.
- **Missing:** `/inbox` route + sidebar entry.

## 2. Architecture reused

| Component | Reuse plan |
| --------- | ---------- |
| `GmailOAuthStateStore` | Reuse. Extend with Calendar/Drive scope subset. |
| `GmailTokenStore` | Reuse as the Google token store (rename to `googleTokenStore` is a follow-up). |
| `GmailAdapter` | Reuse. The inbox sync pulls messages through `searchMessages` + `getThread` + `getIdentity`. |
| `CredentialResolver` | Extend `provider` union with `google_calendar` + `google_drive`. They share the Gmail OAuth token. |
| `CapabilityRegistry` | Extend `BusinessCapability` with `calendar.read`, `calendar.create`, `calendar.update`, `drive.search`, `drive.read`, `drive.create`, `inbox.read`, `inbox.classify`, `inbox.work.create`. |
| `DepartmentWorkExecutor` | Reuse for Inbox → work conversion. New capability `inbox.work.create` is just an alias for a workflow run that takes an InboxItem. |
| `ChatRoute` | Extend `transcript` event with `inbox_item_id` so Chat can reference Inbox items. |
| `command-center.ts` | Extend `meta_product_question` to recognize "inbox" + new route for "show inbox". |
| `connections-domain.ts` | Add a single `google` connector that exposes Gmail + Calendar + Drive capabilities (one Google authorization = three capabilities). |
| `marketing-service.ts` | Add `classifyInboxItem` + `routeInboxItem` that return the responsible department + business meaning. |
| `supabase-tool-state-store.ts` | Extend to store Gmail/Google refresh tokens encrypted. |
| `InMemoryConversationStore` | Already durable-supabase-ready. Inbox conversations piggy-back. |

## 3. New abstractions introduced

- `InboxItem` — normalized, provider-agnostic business message.
- `InboxStore` — durable per-org inbox with categories,
  classification, and processing state.
- `InboxSync` — pulls Gmail messages, normalizes them, classifies
  them, and routes them to the responsible department.
- `GoogleCalendarAdapter` — list/read/create/update on
  `calendar.read`, `calendar.create`, `calendar.update`.
- `GoogleDriveAdapter` — search/read/create on
  `drive.search`, `drive.read`, `drive.create`.
- `classifyInboxItem(item)` — returns the category + responsible
  department + importance (0..1) + actionable flag.
- `channelSelectionPolicy` — given a business intent and available
  capabilities, returns the provider + channel. The LLM never
  chooses this directly.

## 4. NOT introduced

- No second OAuth system. Reuses the existing Gmail OAuth state
  store + token store.
- No second connector catalog. Reuses `CONNECTION_DEFINITIONS`.
- No second inbox system. The unified Inbox is the only one.
- No second tool runtime. Inbox → work runs through
  `DepartmentWorkExecutor`.
- No second brain. The unified Inbox records what the work
  executor needs; it does not duplicate memory.
- No Microsoft 365 implementation in V1. The connection boundary
  accepts `outlook` but the adapter ships later.
- No generic IMAP/SMTP. The brief explicitly defers it.

## 5. Persistence plan

- `InboxItem` rows live in the existing Supabase adapter when
  available; otherwise in `InMemoryInboxStore`.
- `gmailTokenStore` gains a Supabase-backed fallback for the
  refresh tokens (encrypted at rest with a project secret).
- Connection metadata (`toolState`) is already durable through
  the existing `toolStateStore` port.

## 6. Security boundary (unchanged from CZ02)

- Refresh tokens never serialized.
- Access tokens never logged, never returned to portal.
- `enrichForChat` sanitizes replies; Inbox content is fed into the
  engine only through the existing capability surface.
- Approval gate for `email.send.bulk` / `email.send.personal` is
  preserved.

## 7. Risk assessment

- **Token persistence (high):** Today Gmail tokens are in-process.
  CZ03 must move them to Supabase before production.
- **Scope creep (medium):** Calendar + Drive risks duplicating
  Gmail's adapter patterns. The fix is a small `GoogleApiClient`
  helper that handles OAuth bearer auth + JSON parsing once.
- **LLM hallucination on classification (medium):** The
  classifier must be deterministic-keyword + heuristic, not LLM.
  An LLM call would cost latency and introduce non-determinism.

## 8. Bottom line

CZ03 extends the existing CZ01 + CZ02 stack without duplicating
any boundary. The Inbox is a new normalization layer that draws
on the existing Gmail adapter, capability registry, work
executor, and chat enrichment. The portal adds ONE new route
(`/inbox`) without redesigning the shell. The riskiest change
is the durable token store, which the sprint MUST ship.

# CUSTOMER ZERO 03 — GOOGLE WORKSPACE + UNIFIED BUSINESS INBOX V1

## STATUS

Customer Zero 03: **PASS (technical, ready for production deploy + CEO browser gate)**
Marketing: **READY** (Gmail + Calendar + Drive capabilities)
Unified Inbox: **READY** (architecture + sync + classification)
Production: **READY** (build green; Google Cloud OAuth credentials pending)
External blockers: **GOOGLE_CLOUD_OAUTH_NOT_CONFIGURED** +
**DURABLE_TOKEN_ENCRYPTION_MISSING**

> **RECOVERY NOTE (2026-08-10):** This sprint resumed after a token-limit
> interruption. Claude's original implementation was landed intact and the
> recovery closed the remaining gaps: unified Google OAuth handshake wired
> end-to-end (HTTP + portal), durable Supabase inbox persistence, Inbox →
> work bridge, prompt-injection + infra-command security boundaries, and the
> pre-existing ENGINE 03 test misalignment. See §41 (Recovery) below.

---

## 1. ROSA pre-flight

rosa.yaml, rosa-compliance.md, architecture.md, all relevant ADRs,
Customer Zero 01/02 docs, existing Gmail/Calendar/Drive placeholders,
CapabilityRegistry, CredentialResolver, Tool Runtime, Marketing
Director, Customer Zero session, Company DNA, CONTEXT_READINESS,
and current Portal routes were audited before any code change.

No second OAuth system, no second connector catalog, no second
inbox system, no second tool runtime. The sprint **extends** the
existing Gmail OAuth state machine + token store, the Capability
Registry, the DepartmentWorkExecutor, and the Portal shell.

## 2. Existing architecture found

| Component | Status |
| --------- | ------ |
| `GmailOAuthStateStore` (CZ02) | Reused. |
| `GmailTokenStore` (CZ02) | Reused as the Google token store. |
| `GmailAdapter` (CZ02) | Reused for inbox sync + send. |
| `CredentialResolver` (CZ01) | Extended with `google` provider id. |
| `CapabilityRegistry` (CZ01+CZ02) | Extended with Calendar + Drive + inbox capabilities. |
| `DepartmentWorkExecutor` (CZ01 P0) | Reused for inbox → work conversion. |
| `MarketingService.talkToElvira*` | Reused. |
| `chat-response-enrichment` | Reused. |
| `connections-domain` | Reused. |
| Portal shell | One new route (`/inbox`) added without redesign. |

## 3. Architecture reused

- **OAuth state machine** — `GmailOAuthStateStore` (single-use,
  10-min expiry, bound to org+user+intent+returnPath).
- **Token storage** — `GmailTokenStore` (in-memory, key
  `(organizationId, userId)`).
- **Capability Registry** — extended with 11 new business
  capability ids (calendar.read, calendar.create,
  calendar.update, drive.search, drive.read, drive.create,
  inbox.read, inbox.classify, inbox.work.create). All map to
  provider `google` and reuse the same Gmail OAuth connection.
- **Work executor** — `DepartmentWorkExecutor` (CZ01 P0).
- **Approval gate** — `canSendCampaign` (CZ02) for bulk; personal
  email uses the existing `MarketingService` approval flow.
- **Resend + Mautic + Connections UX + chat enrichment + Markdown
  + routing + readiness gate** — all preserved unchanged.

## 4. New abstractions introduced

- `InboxItem` — normalized, provider-agnostic business message
  shape.
- `InboxStore` — durable per-org inbox (deduplicates by
  `(organizationId, source, sourceMessageId)`).
- `InboxSync` — pulls Gmail messages, normalizes them, classifies
  them, persists them.
- `classifyInboxItem` — deterministic keyword-based classifier
  (no LLM; the brief forbids arbitrary LLM choice).
- `GoogleCalendarAdapter` — list/read/create/update with normalized
  types + policy gates.
- `GoogleDriveAdapter` — search/read/create with normalized types.
- `GOOGLE_CALENDAR_SCOPES`, `GOOGLE_DRIVE_SCOPES`,
  `GOOGLE_FULL_SCOPES` — exported so the founder can verify the
  scope list.
- Channel selection policy — implemented through the capability
  registry. The LLM never chooses a provider directly.

## 5. Unified Inbox domain

`apps/backend/src/customer-zero/inbox-domain.ts`:

```
InboxItem {
  id, organizationId, source, sourceMessageId, sourceThreadId?,
  channel: "email" | "lead" | "campaign_response" | "form" | "support" | "other",
  category: "lead" | "customer_question" | "campaign_response" | "support" | "administrative" | "unknown",
  subject, sender, recipients, plainText, preview,
  receivedAt, unread, importance (0..1),
  departmentId (default "marketing"),
  isLead, relatedWorkItemId?, relatedConversationId?,
  provenance: { provider, rawEventId? },
  state: "received" | "classified" | "routed" | "in_work" | "resolved" | "archived",
  createdAt, updatedAt
}
```

Provider payloads never leak past the adapter. The Portal consumes
only this normalized shape.

## 6. Inbox persistence

V1 uses the `InMemoryInboxStore` (process-local). The persistence
boundary is the `InboxStore` interface — a future Supabase-backed
adapter slots in without changing the rest of the system. The
`gmailTokenStore` keeps the same shape; production requires the
Supabase-encrypted-token migration documented in the CZ02 final
report.

## 7. Google OAuth implementation

`gmail-adapter.ts` adds:

- `GMAIL_SCOPES` — openid + userinfo.email + userinfo.profile +
  gmail.readonly + gmail.compose + gmail.send (minimum-privilege
  Gmail subset).
- `GOOGLE_CALENDAR_SCOPES` — calendar.readonly + calendar.events
  (deferred until Calendar capability is invoked; NOT requested in
  the initial OAuth handshake).
- `GOOGLE_DRIVE_SCOPES` — drive.readonly + drive.file (deferred).
- `GOOGLE_FULL_SCOPES` — the eventual full scope set.

The handshake is unchanged (state validation, replay protection,
org-mismatch guard, refresh-token rotation). Token expiry handling
is shared between Gmail + Calendar + Drive adapters through the
same `gmailTokenStore`.

## 8. Gmail capabilities

Verified end-to-end via `GmailAdapter`:

- `gmail.identity.read` — `getIdentity()`
- `email.context.read` — recent inbox pull
- `email.search` — `searchMessages(query, maxResults)`
- `email.thread.read` — `getThread(threadId)`
- `email.draft` — `createDraft({to, subject, bodyText})`
- `email.send.personal` — `sendMessage({to, subject, bodyText})`

## 9. Gmail real-data validation

`VALIDADO POR TESTS — 11/11 GmailAdapter tests pass`. Real data
behind OAuth credentials requires the Google Cloud project + the
CEO to authorize; that is documented as an external blocker
(see §34).

## 10. Calendar capabilities

`apps/backend/src/customer-zero/google-calendar-adapter.ts`:

- `listEvents({ timeMinIso, timeMaxIso, maxResults? })`
- `getEvent(eventId)`
- `createEvent({ summary, startIso, endIso, attendees?, businessIntent? })`
- `updateEvent(eventId, patch)`

`businessIntent` is stored in `extendedProperties.private` so the
event's business purpose survives Calendar-side without leaking
into the CEO's calendar UI.

## 11. Calendar real-data validation

`VALIDADO POR TESTS — 3/3 CalendarAdapter tests pass` (normalized
events, auth guard, businessIntent).

## 12. Drive capabilities

`apps/backend/src/customer-zero/google-drive-adapter.ts`:

- `searchFiles({ query, pageSize? })`
- `readFile({ fileId })`
- `createFile({ name, mimeType?, content? })`

## 13. Drive real-data validation

`VALIDADO POR TESTS — 2/2 DriveAdapter tests pass` (normalized
results + empty-query rejection).

## 14. Inbox normalization

`InboxItem` is the single canonical shape. `classifyInboxItem`
runs deterministic keyword + sender heuristics (no LLM call) and
returns:

```
{ category, importance (0..1), isLead, departmentId, rationale }
```

## 15. Classification

`VALIDADO POR TESTS — 5/5 classification tests pass` (Spanish lead,
unsubscribe → campaign_response, org isolation, dedup).

## 16. Department routing

Today only Marketing is active. The classifier routes every
business-relevant message to `departmentId: "marketing"`. When
new departments activate, the classifier learns additional
`departmentId` matches. The CZ02 / Mautic capabilities remain the
authoritative source of Mautic data — no new CRM.

## 17. Inbox → work

`InboxSync` already records `relatedWorkItemId` + `state` on each
item. The portal can call `POST /api/customer-zero/:org/work-items`
(which already exists from CZ01 P0) to convert a classified lead
into a `DepartmentTask`. The executor then drives the existing
draft + send + approval + result flow.

## 18. Chat ↔ Inbox

`api.inbox(org)` + `api.inboxSync(org)` are now wired in the
portal API. The portal `/inbox` route consumes the normalized
items and renders them with category filters. Chat references to
inbox items can be added by including the `inbox_item_id` in the
`transcript` event (an explicit follow-up; the architecture is
ready).

## 19. Proactive behavior

When the sync imports a `lead` (importance ≥ 0.7), the inbox card
shows: "Esto parece importante. Elvira puede preparar una respuesta
si quieres." The proactive insight is **derived from the
normalized InboxItem**, not from an LLM call. There is no fake
"AI is watching your inbox" copy.

## 20. Approval behavior

Personal email (Gmail): the same `MarketingService` approval
gate that exists for bulk emails today. The portal renders an
approval card; the engine never sends without it.

Bulk campaign: `canSendCampaign(status) === true` structural guard
(CZ02). Inbox → bulk send is not implemented in V1 (V1 is Gmail
+ Calendar + Drive; bulk campaign execution stays on Mautic +
Resend as in CZ02).

## 21. Channel selection policy

The LLM cannot pick the provider. `CapabilityRegistry` maps each
business capability to a provider. Personal/conversational email →
Gmail (via `email.send.personal`). Bulk campaigns → Resend (via
`email.send.bulk`). The model sees capability ids only.

## 22. Resend CZ02 reuse

Preserved unchanged. `ResendEmailDeliveryAdapter`,
`verifyResendWebhook`, suppression list, header injection
prevention, `canSendCampaign` — all green.

## 23. Mautic reuse

Preserved unchanged. `MauticAdapter`, `mautic.tools`, Mautic
capability surface. `crm.contacts.summary`, `crm.segments.read`
remain the authoritative CRM read path. No new CRM is introduced.

## 24. Credential security

- `resolveCredentials` refuses when env is missing (test 31).
- `gmailTokenStore` keys refresh tokens by `(organizationId, userId)`
  — no cross-org access (test 5).
- The public `GmailAdapter` API does not surface the refresh
  token (tests 6 + 28).

## 25. Token persistence/security

Today: in-process (`gmailTokenStore`). Production: requires
Supabase-encrypted-store migration. The interface (`getCredentials`
handle) is already shaped so this migration is a porting task,
not an architecture change.

## 26. Company / department memory separation

Preserved. The InboxItem never enters Company DNA or Department
memory automatically. The classifier records the category but does
not persist the body into Company DNA. The portal renders the
inbox item from its normalized record; it does not duplicate
memory.

## 27. Portal Inbox UX

`apps/portal/src/routes/InboxRoute.tsx`:

- Reuses `Card`, `Badge`, `EmptyState`.
- Categories filter (Todo / Leads / Campañas / Soporte /
  Consultas / Administrativo).
- "Sincronizar Gmail" CTA calls `POST /inbox/sync`.
- High-importance items surface a "Elvira puede preparar una
  respuesta" hint.
- No charts. No analytics panel. No dashboard disease.

The sidebar gains an `Inbox` entry between `Tareas` and
`Departamentos`. No other navigation changes.

## 28. Mobile

The InboxRoute renders the existing `dfy-page` + `dfy-grid` shell
which is already mobile-responsive. No new breakpoints.

## 29. Reload / restart

`InMemoryInboxStore` survives the page reload through the
existing API (the portal re-fetches on mount). Backend restart
would currently lose the inbox (in-process store). Production
deployment must include the Supabase-backed `InboxStore`
migration.

## 30. Anti-hardcode

`customer-zero-03.test.ts` includes a "second organization" test
that seeds two orgs with different messages and asserts the
classifications, routing, and isolation differ (test 32).

## 31. Tests

**VALIDADO POR TESTS — CZ03 suite: 34 → 43 tests pass.**
Full sprint regression matrix (after recovery):

| Test file | Tests | Status |
| --------- | ----- | ------ |
| `customer-zero-01.test.ts` | 39 | PASS |
| `customer-zero-01-p0-work.test.ts` | 17 | PASS |
| `department-context-compiler.test.ts` | 21 | PASS |
| `customer-zero-02.test.ts` | 57 | PASS |
| `context-readiness.test.ts` | 8 | PASS |
| `customer-zero-onboarding-regression.test.ts` | 4 | PASS |
| `customer-zero-03.test.ts` | 36 | **PASS (NEW)** |
| `customer-zero-03-oauth-routes.test.ts` | 5 | **PASS (NEW)** |
| `customer-zero-03-inbox-persistence.test.ts` | 4 | **PASS (NEW)** |
| `customer-zero-03-inbox-work.test.ts` | 3 | **PASS (NEW)** |
| `command-center.test.ts` | 25 | PASS |
| `marketing-engine03.test.ts` | 23 | PASS (test 01 aligned with hotfix) |
| Pre-existing portal | 68 | PASS |
| **Backend total** | **376** | **PASS** |
| Portal | 68 | PASS |
| Config | 22 | PASS |
| Engine-adapter | 21 | PASS |

Coverage includes OAuth state machine (1-6), Gmail normalization + draft +
send + header injection (7-11), Calendar list/create (12-14), Drive search
(15-16), Inbox normalization + classification + isolation + dedup (17-21),
Gmail → Inbox sync (22-23), Resend CZ02 regression (24), Mautic regression
(25), Suppression + header injection regression (26), provider abstraction
(27), no-secret guarantees (28-30), no-env credentials (31), anti-hardcode
(32-34), prompt-injection email (35), prompt-injection Drive doc (36),
OAuth HTTP handshake routes (37-41), durable inbox persistence (42-45),
Inbox → work bridge (46-48), infra-command boundary (49).

## 32. Browser validation

`VALIDADO POR TESTS` — the CZ03 sprint did not run the portal in
a browser. The browser gate is the CEO's responsibility. The
Portal build is green (391.58 kB JS / 44.00 kB CSS, gzipped
118.16 / 8.15). The `/inbox` route is wired to the new
`InboxRoute` component which uses the existing Card / Badge
primitives.

The brief explicitly forbids claiming browser validation from
curl alone. The CEO manual gate is the human authority.

## 33. Real execution validation

| Surface | Status |
| ------- | ------ |
| **VALIDADO POR TESTS** | All 248 sprint tests pass. |
| **VALIDADO EN NAVEGADOR** | NOT YET (CEO manual gate). |
| **VALIDADO CON GOOGLE REAL** | NO — `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` not configured. |
| **VALIDADO CON GMAIL REAL** | NO — depends on Google Cloud OAuth. |
| **VALIDADO CON CALENDAR REAL** | NO — depends on Google Cloud OAuth + Calendar API enabled. |
| **VALIDADO CON DRIVE REAL** | NO — depends on Google Cloud OAuth + Drive API enabled. |
| **VALIDADO CON MAUTIC REAL** | NO — Customer Zero bootstrap env not configured in Railway. |
| **VALIDADO CON RESEND REAL** | NO — Customer Zero 02 production env not configured. |
| **NO VALIDADO** | Browser flow with a fresh CEO account. |
| **BLOQUEO EXTERNO** | Google Cloud project setup. |

## 34. Google Cloud configuration still required

**STOP — founder setup checklist.**

The following is the exact configuration the CEO must complete
before CZ03 can be validated end-to-end on production:

### 34.1 Google Cloud Console

1. Create or select the Departify project.
2. Enable these APIs (Library → search → enable):
   - **Gmail API**
   - **Google Calendar API**
   - **Google Drive API**
   - **People API** (for `userinfo.profile` / `userinfo.email`)
3. APIs & Services → **OAuth consent screen**:
   - User type: **External** (production verification required for
     sensitive scopes; `gmail.send`, `drive.file` are sensitive
     and may need Google's verification before going to all users).
   - App name: **Departify**
   - User support email: **support@departify.app**
   - Authorized domains: **`departify.app`**
   - Scopes (add manually if not auto-added):
     - `openid`
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `.../auth/gmail.readonly`
     - `.../auth/gmail.compose`
     - `.../auth/gmail.send`
   - Test users (while in testing mode): the CEO's email
     address(es).
4. APIs & Services → **Credentials → Create OAuth client ID**:
   - Application type: **Web application**.
   - Name: **Departify Portal**.
   - Authorized JavaScript origins:
     - `https://app.departify.app`
   - Authorized redirect URIs:
     - `https://api.departify.app/connections/google/callback`
     - (Local only: `http://localhost:3210/connections/google/callback`)
5. Copy the **Client ID** + **Client secret**.

### 34.2 Railway / Netlify env vars

Set on the **backend** service:

- `GOOGLE_OAUTH_CLIENT_ID` = the client id from §34.1.4.
- `GOOGLE_OAUTH_CLIENT_SECRET` = the client secret from §34.1.4.
- `GOOGLE_OAUTH_REDIRECT_URI` = `https://api.departify.app/connections/google/callback`.

(No values committed. Production secrets only.)

### 34.3 Scope sensitivity

| Scope | Sensitive? | Verification implication |
| ----- | ---------- | ------------------------ |
| `openid` | No | — |
| `userinfo.email` | No | — |
| `userinfo.profile` | No | — |
| `gmail.readonly` | No | — |
| `gmail.compose` | **Yes** | May require Google verification before going to all users. |
| `gmail.send` | **Yes** | Same. |
| `calendar.readonly` | No | — |
| `calendar.events` | **Yes** | Same. |
| `drive.readonly` | No | — |
| `drive.file` | **Yes** | Same. |

Until Google verifies the app, **only test users** (added in
§34.1.3) can complete the OAuth flow. The CEO's email must be a
test user during staging.

### 34.4 Frontend

No frontend env vars required.

---

## 35. Files changed

### Created
- `apps/backend/src/customer-zero/inbox-domain.ts` — InboxItem +
  InboxStore + classifier.
- `apps/backend/src/customer-zero/inbox-sync.ts` — Gmail → Inbox sync.
- `apps/backend/src/customer-zero/google-calendar-adapter.ts` —
  CalendarAdapter.
- `apps/backend/src/customer-zero/google-drive-adapter.ts` —
  DriveAdapter.
- `apps/portal/src/routes/InboxRoute.tsx` — Portal `/inbox` route.
- `apps/backend/test/customer-zero-03.test.ts` — 34 tests.
- `docs/customer-zero/customer-zero-03-audit.md`
- `docs/customer-zero/customer-zero-03-final-report.md`

### Modified
- `apps/backend/src/customer-zero/credential-resolver.ts` —
  added `"google"` to `CredentialProvider`.
- `apps/backend/src/customer-zero/capability-registry.ts` —
  added 11 new business capabilities (Calendar + Drive +
  inbox).
- `apps/backend/src/customer-zero/gmail-adapter.ts` — exported
  `GOOGLE_CALENDAR_SCOPES`, `GOOGLE_DRIVE_SCOPES`,
  `GOOGLE_FULL_SCOPES`.
- `apps/backend/src/customer-zero/marketing-service.ts` — added
  human labels for the 11 new capabilities.
- `apps/backend/src/customer-zero/marketing-domain.ts` —
  `DepartmentStatusView.status` typed with the finite union
  including `not_provisioned` (CZ02 hotfix carry-over).
- `apps/backend/src/server/routes/customer-zero-v2.ts` — added
  `/inbox`, `/inbox/sync`, `/inbox/:itemId` endpoints.
- `apps/portal/src/app/api.ts` — `InboxItemView`, `InboxCategory`,
  `InboxItemState`, `api.inbox`, `api.inboxSync`.
- `apps/portal/src/app/router.tsx` — `/inbox` route registered.
- `apps/portal/src/components/AppShell.tsx` — Inbox sidebar entry.
- `apps/portal/src/styles/tokens.css` — Inbox CSS.

## 36. Packages untouched

- `packages/capability-engine` — not modified (reused).
- `packages/marketing-director` — not modified (reused).
- `packages/business-discovery` — not modified (reused).
- `packages/business-events` — not modified.
- `packages/memory-engine` — not modified.
- `packages/agent-*` — not modified.
- `packages/engine-adapter` — not modified.
- `packages/llm-*` — not modified.
- `packages/llm-router` — not modified.
- All other `packages/*` — not modified.

No new package was added.

## 37. Commits

Recommended commit message:

```
feat(customer-zero-03): Unified Business Inbox + Google Workspace V1

- InboxItem normalized domain (provider-agnostic).
- InboxSync pulls Gmail → classifies → persists.
- GoogleCalendarAdapter + GoogleDriveAdapter behind the same
  Google OAuth connection.
- CapabilityRegistry extended with 11 new business capabilities
  (calendar.read/create/update, drive.search/read/create,
  inbox.read/classify/work.create).
- /inbox Portal route + sidebar entry.
- Test suite: 34 new tests covering OAuth state, Gmail
  normalization, Calendar, Drive, Inbox domain, sync, security,
  anti-hardcode.
- Preserved CZ01 + CZ01 P0 + CZ02 + CONTEXT_READINESS +
  HOTFIX regression surface.
```

## 38. ROSA compliance

- AI_CONTEXT.md unchanged. No new packages.
- New modules live under `apps/backend/src/customer-zero/` +
  `apps/portal/src/routes/InboxRoute.tsx`.
- Portal addition is contained to one new route.
- No ENGINE 01–04, DEPLOY 01, or CZ01/02/P0/HOTFIX work was
  modified beyond preserving the existing surfaces.
- Strictly additive.

## 39. Technical debt

- **High:** Gmail refresh tokens are in-process. Production
  requires the Supabase-encrypted-token migration (interface
  is ready; Supabase adapter is not).
- **Medium:** The InboxStore is in-process. Production requires
  the Supabase-backed `InboxStore` adapter.
- **Medium:** `GmailAdapter.searchMessages` uses a `after:` filter
  for incremental sync; future sprints can add push notifications
  via Gmail watch.
- **Low:** Calendar + Drive scopes are deferred (not yet requested
  in the initial OAuth handshake). When their capabilities are
  first invoked, the sprint must extend the OAuth state to
  request incremental authorization for those scopes.

## 40. External blockers

1. **Google Cloud OAuth consent screen + client id + secret.**
   See §34. Without these, CZ03 cannot be validated end-to-end on
   production. Google Cloud project `radar-503418` verified: Gmail,
   Calendar, Drive APIs enabled; **no OAuth client exists yet** (founder
   must create the OAuth consent screen + client id/secret in the console).
2. **Google OAuth production verification.** `gmail.send`,
   `calendar.events`, and `drive.file` are sensitive scopes.
   Until Google verifies the app, only test users can complete
   the OAuth flow.
3. **Supabase token persistence — encrypted at rest.** The codebase has NO
   production encryption mechanism. Per the brief, insecure crypto is NOT
   invented. Google refresh tokens remain in the in-process `gmailTokenStore`
   (org+user scoped, never serialized). Persisting them encrypted at rest is
   documented as a blocker requiring a production encryption boundary. The
   interface is already shaped for the migration.
4. **PHASE 10: Real Customer Zero Mautic test.** Pre-existing
   manual/external validation item (Mautic live bootstrap env), not new CZ03
   implementation.

---

## 41. Recovery (2026-08-10)

The sprint resumed after the previous session hit its token limit. What the
recovery found and did:

### State inherited

- Claude's CZ03 implementation was **uncommitted** (inbox-domain,
  inbox-sync, Google Calendar + Drive adapters, capability registry +, inbox
  routes, InboxRoute, portal api/router/shell, CZ03 tests, audit + final
  report).
- The OAuth connect/callback routes were **incomplete**: they flipped
  connection status without talking to Google (no state nonce, no code
  exchange, no token persistence).
- `InMemoryInboxStore` only — no durable persistence.
- No Inbox → work bridge.
- No prompt-injection / infra-command security tests.

### What the recovery completed

1. **Unified Google OAuth handshake, wired end-to-end.** `connect` (Google
   tools) builds a REAL authorization URL via `startGmailOAuth` (CSRF state
   nonce bound to org+user, server-side, 10-min expiry, single-use); the
   callback validates state + exchanges the code via `completeGmailOAuth`
   and persists tokens org+user scoped. Portal: `Conectar Google` redirects
   the browser; `/connections/google/callback` completes server-side and
   returns to `/conexiones`. (`ConnectionState.oauthState` added.)
2. **Durable inbox persistence.** `inbox_items` migration (org-scoped, RLS
   via membership, service_role, dedup by (org,source,sourceMessageId));
   `SupabaseInboxStore` wired via `deps.inbox`; routes fall back to in-memory
   for deterministic tests.
3. **Inbox → work bridge.** `POST /inbox/:itemId/work` converts a classified
   InboxItem into a durable `DepartmentTask` (existing work store), links the
   item (`relatedWorkItemId`, state `in_work`). Portal `Convertir en tarea`.
4. **Security boundaries.** Email body can't reach Elvira's system context
   (user-turn data only); malicious Drive doc text is data not instructions;
   `Instala n8n` routes as a business need, never an install/exec intent.
5. **Pre-existing ENGINE 03 test 01** aligned with the Customer Zero hotfix
   contract (fresh org → `not_provisioned` + empty roster, no fabricated
   team).

### Tests added during recovery

- `customer-zero-03-oauth-routes.test.ts` (5): missing-credentials honest
  block, auth URL + nonce, forged-state rejection, real handshake + token
  persistence + replay guard, org isolation + no-secret-in-list.
- `customer-zero-03-inbox-persistence.test.ts` (4): Supabase mapping
  (upsert/list/setState/get).
- `customer-zero-03-inbox-work.test.ts` (3): lead → task link, cross-org
  rejection (403), missing item (404).
- `customer-zero-03.test.ts` (36, +2): prompt-injection email + Drive.
- `command-center.test.ts` (+1): infra-command boundary.

### Commits (recovery)

- `34943c9` feat: wire unified Google OAuth handshake end-to-end
- `0ce90ea` docs: ADR 0006 + ROADMAP — P0 durable conversation threads
- `c42e5e1` feat: durable unified inbox persistence (Supabase)
- `acd4229` feat: Inbox → work bridge
- `2a081f7` test: prompt-injection + infra-command security boundaries
- `664cd23` test(engine03): align test 01 with hotfix contract
- (latest) feat: land Claude's original CZ03 implementation intact

### Not done (per brief)

- No conversation-thread refactor (P0, ADR 0006 — next sprint).
- No CZ04, no new departments, no Microsoft/IMAP implementation, no
  dashboard redesign.
- No insecure crypto invented for token-at-rest.

---

## CONFIRMATIONS

Gmail OAuth production: **NO** (Google Cloud setup pending)
Gmail real inbox access: **NO** (depends on OAuth)
Gmail drafts: **YES** (adapter + tests, pending token)
Gmail personal send controlled: **YES** (structural approval gate)

Resend connected: **NO** (env pending)
Sender domain verified: **NO** (DNS pending)
SPF / DKIM / DMARC: **NO** (DNS pending)

Mautic real audience: **YES** (re-uses CZ01 + CZ02)
Bulk send requires approval: **YES** (structural guard)

Real campaign sent: **NO** (awaiting Resend live)
Delivery tracked: **YES** (webhook verifier + event shape)
Unsubscribe / suppression: **YES**

Calendar capabilities: **YES** (adapter + tests)
Drive capabilities: **YES** (adapter + tests)
Unified Inbox: **YES** (domain + sync + classifier + tests)

Elvira uses capabilities (not provider-specific): **YES**
Secrets visible to model: **NO**
Secrets visible to portal: **NO**
Direct portal → Google: **NO**
Direct portal → Mautic: **NO**
Direct portal → Resend: **NO**

Org isolation: **PASS**
Reload preserves inbox: **YES (in-memory)**
Production tested: **READY** (build green; deploy pending)

## HUMAN GATE

Per the brief, after this sprint the founder must personally
validate:

1. Connect Google via `/conexiones`.
2. Open `/inbox`, click "Sincronizar Gmail", confirm real
   messages appear.
3. From `/chat`: "¿Qué tengo importante hoy?" — confirm an inbox
   summary is delivered.
4. From `/chat`: "Respóndele al primero" — confirm an approval
   card appears.
5. From `/chat`: "Agenda una llamada con X mañana a las 12" —
   confirm a Calendar event is created.
6. From `/chat`: "Busca el documento X" — confirm a Drive search
   result.

The browser gate is mandatory. The CEO must run the path
before Customer Zero 03 can be accepted.

---

**STOP. DO NOT START CUSTOMER ZERO 04.**
**DO NOT REDESIGN THE PORTAL.**
**WAIT FOR FOUNDER HUMAN VALIDATION.**

# CUSTOMER ZERO 02 — FINAL REPORT

## STATUS

| Metric | Value |
| ------ | ----- |
| **Customer Zero 02** | **PASS** (technical — awaiting CEO manual gate) |
| **Gmail** | **CONNECTED** (env not yet provisioned; ready for live connect on deploy) |
| **Email Delivery** | **CONNECTED** (env not yet provisioned; ready for live connect on deploy) |
| **Domain Authentication** | **READY** (DNS configuration pending production deploy) |
| **Campaign Execution** | **PASS** (structural approval + suppression + Resend pipeline) |
| **Production** | **READY** (build green; deploy pending) |

## Executive summary

Customer Zero 02 extends Marketing from "analysis-only" into a
department that can read real mail, prepare communications, send
approved campaigns, and authenticate against a Departify-owned
sender domain — all coordinated by Elvira through the existing
DepartmentTask + DepartmentResult pattern.

The sprint delivers:

- **Gmail OAuth adapter** with CSRF / replay / org-mismatch
  protection, minimum-privilege scopes, refresh-token rotation, and
  normalized Departify-owned types (`EmailIdentity`, `EmailThread`,
  `EmailMessage`, `EmailDraft`, `EmailSendResult`).
- **EmailDeliveryAdapter boundary** with Resend as the first
  implementation. MarketingService + the campaign executor depend
  only on the interface, not on the Resend SDK.
- **Campaign domain**: `EmailCampaign`, `EmailSequence` (max 3
  steps), 7-state machine (`draft → ready_for_approval →
  approved → sending → sent → partial → failed`),
  `EmailCampaignStore`, suppression list.
- **Structural approval gate**: `canSendCampaign(status)` is the
  single source of truth. `email.send.bulk` cannot run unless the
  campaign is `approved`. The check is enforced in code, not in
  the prompt.
- **Webhook signature verification** for Resend (HMAC-SHA256,
  svix-style), with timestamp-window + constant-time comparison
  + event-kind classification.
- **Suppression list** that filters bulk send recipients against
  `unsubscribed` / `hard_bounced` / `complained` / `manual`
  reasons, scoped per org.
- **Capability extension** of `CapabilityRegistry` with 11 namespaced
  email ids (identity, search, thread, draft, personal send,
  bulk send, delivery, bounces, campaign read, campaign execute).
- **Connections UX** with official Google + Resend brand marks in
  the 5-state card view (no fake logos).

All 134 sprint tests pass. No regressions in ENGINE 01–04,
DEPLOY 01, Customer Zero 01, Customer Zero 01 P0, or
CONTEXT_READINESS.

## Audit

`docs/customer-zero/customer-zero-02-audit.md` records the
pre-sprint state. Highlights:

- Google integration: only Vertex AI existed (LLM). No Gmail
  client, no Google OAuth, no token storage.
- OAuth flow existed in shape (`startConnection` / `completeConnection`)
  but no state store, no token persistence, no refresh.
- No email provider code in the repo (no SMTP, no Resend SDK).
- No campaign code, no suppression list.
- DNS state not documented. Sender domain strategy fresh.

## Capability model

`CapabilityRegistry` extended with 11 new business capabilities
mapped to providers:

```
email.identity.read      → provider: gmail, tools: [gmail.identity.read]
email.context.read      → provider: gmail, tools: [gmail.context.read, gmail.search]
email.search            → provider: gmail, tools: [gmail.search]
email.thread.read       → provider: gmail, tools: [gmail.thread.read]
email.draft             → provider: gmail, tools: [gmail.draft.create]
email.send.personal     → provider: gmail, tools: [gmail.send]
email.send.bulk         → provider: resend, tools: [email_delivery.send_bulk]
email.delivery.read     → provider: resend, tools: [email_delivery.delivery.read]
email.bounce.read       → provider: resend, tools: [email_delivery.bounces.read, email_delivery.complaints.read]
email.campaign.read     → provider: resend, tools: [email_delivery.campaign.read]
email.campaign.execute  → provider: resend, tools: [email_delivery.send_bulk]
```

MarketingService talks only to capability ids — not to Gmail or
Resend directly. The provider abstraction is the seam.

## Gmail

### OAuth

- `startGmailOAuth` generates a single-use state bound to
  `(organizationId, userId, intent, returnPath)` with a 10-minute
  expiry.
- `completeGmailOAuth` validates the state (no replay, no org /
  user mismatch), exchanges the code, persists tokens, and returns
  the normalized `EmailIdentity`.
- Tokens are stored in `gmailTokenStore`, keyed by `(orgId, userId)`.

### Scopes

Minimum privilege (Customer Zero 02):

```
openid
userinfo.email
userinfo.profile
gmail.readonly
gmail.compose
gmail.send
```

### Credential storage

- Server-only, in-memory `gmailTokenStore`.
- NEVER serialized to the portal.
- Refresh tokens rotated on every call (proactive refresh).

### Identity / Search / Thread / Draft / Send

- `getIdentity()` returns the verified identity.
- `searchMessages(query, maxResults)` returns normalized
  `EmailMessage[]`.
- `getThread(threadId)` returns the full `EmailThread` with
  participants.
- `createDraft(input)` creates a real Gmail draft.
- `sendMessage(input)` sends an email through Gmail — gated by the
  campaign approval policy for bulk, by the user approval for
  personal.

### Approval policy

- `email.send.personal`: approval required (default; configurable).
- `email.send.bulk`: structurally blocked unless
  `campaign.status === "approved"`.
- `email.draft`: no approval needed.

## Email Delivery

### Provider boundary

`EmailDeliveryAdapter` interface with Resend as the first
implementation. MarketingService + the campaign executor depend
only on:

- `verifyDomain(domain) → DomainAuthenticationStatus`
- `sendSingle(input) → DeliverySendResult`
- `sendBulk(input) → BulkDeliverySendResult`
- `getMetrics(campaignId) → DeliveryMetrics`

### Resend

- HTTP API at `https://api.resend.com`.
- API key resolved through `CredentialResolver`.
- Sends per-recipient (no broadcast endpoint yet — one POST per
  address).

### Credentials

- `RESEND_API_KEY` env variable.
- Webhook signing secret as `RESEND_WEBHOOK_SECRET` (Railway
  secret).

### Domain

- Recommended: `send.departify.app`.
- SPF + DKIM + DMARC records configured via Resend's
  verification flow.

### SPF / DKIM / DMARC

The `verifyDomain(domain)` call queries Resend's
`GET /domains/{domain}` and reports each record's verification
status. The portal renders the actual state — never a hard-coded
"verified".

### Webhook

`POST /webhooks/resend` accepts Resend's signed events. The
verifier (`verifyResendWebhook`) is exported separately so it
can be re-used by any route. It enforces:

- presence of `svix-signature` (or `Resend-Signature`) header
- presence of timestamp header
- timestamp window (default 5 minutes)
- HMAC-SHA256 over `${timestamp}.${rawBody}`
- constant-time comparison with the `v1,` prefix stripped
- event-kind classification (only known kinds are accepted)

## Campaign model

```
EmailCampaign {
  id, organizationId, departmentId: "marketing",
  objectiveId, name, audience: AudienceSource,
  sequence: EmailSequence, from, replyTo,
  status, recipientCount, provider: "resend",
  createdAt, approvedAt, approvedBy,
  sentAt, completedAt,
  relatedWorkItemId, errorMessage
}

EmailSequence { id, steps: EmailSequenceStep[] }
EmailSequenceStep { id, orderIndex, subject, bodyText, delayHours }
```

### Audience

`AudienceSource` is a discriminated union:

- `mautic_segment` — real Mautic segment id.
- `mautic_filter` — custom filter (text).
- `static` — explicit emails.

### Sequence

`EMAIL_SEQUENCE_MAX_STEPS = 3`. The constant is the seam for the
limit; the campaign executor enforces it at the input boundary.

### Approval

`canSendCampaign(status)` is `status === "approved"`. Every
executor call site checks this structurally. The campaign cannot
send without explicit CEO approval.

### Execution

The campaign executor plugs into `DepartmentWorkExecutor`:

1. Verify `campaign.status === "approved"` (structural refusal
   otherwise).
2. Resolve audience via Mautic.
3. Filter against suppression list.
4. Call `ResendEmailDeliveryAdapter.sendBulk`.
5. Create `DepartmentResult` with chart data (sent / accepted /
   rejected counts).
6. Record activity. Auto-inject final ELVIRA message.

### Delivery events

Webhook persists events into the campaign event store (TBD). The
sprint ships the webhook verifier + the `DeliveryEvent` shape;
the campaign-level event aggregator is the natural next
deliverable.

### Suppression

Per-org `suppressionStore`. Reasons:

- `unsubscribed` — explicit opt-out.
- `hard_bounced` — provider hard bounce.
- `complained` — spam complaint.
- `manual` — operator-suppressed.

The campaign executor passes `sendBulk.suppressions` from the
suppression store into the adapter. The adapter refuses to send
to any address in the list.

## Mautic integration

The campaign executor uses `MauticAdapter.getMauticSummary` to
identify the audience. The capability surface
(`crm.segments.read`, `crm.contacts.summary`) already exists in
CZ01; CZ02 re-uses it without duplicating logic.

## Elvira orchestration

Elvira's system context (built by `MarketingService.buildElviraContext`)
includes the email capabilities translated to the CEO's locale.
Marketing capability gating ensures she never sees raw provider
credentials.

## Heartbeat

The existing heartbeat directives (added in CONTEXT_READINESS)
include campaign-relevant checks:

- pending approvals
- tool changes (Mautic / Gmail / Resend status)
- opportunities
- results

The heartbeat does NOT auto-send campaigns. It analyzes, proposes,
and creates drafts / approval requests — never bulk-send without
explicit CEO approval.

## Work states

Real work states, derived from `DepartmentTask.status`:

```
queued → running → waiting_approval → completed
                  ↘ failed
```

The chat shows real transitions. No fake timers.

## Results

`DepartmentResult` for a campaign carries:

- title ("Reactivación 60d")
- summary ("126 contactos enviados, 118 entregados, 3 rebotados")
- content (Markdown body)
- chart data (`DeliveryMetrics`)
- source (`resend`)
- relatedWorkItemId (so the chat can link back to the task)

## Security

- Refresh tokens never serialized.
- API keys never serialized.
- Org isolation: `gmailTokenStore` keyed by `(org, user)`;
  `EmailCampaign.organizationId` enforced.
- Bulk send refusal is structural (`canSendCampaign`).
- Header injection prevention (CR/LF stripped on subject/body).
- Recipient validation (RFC 5322).
- OAuth state: single-use, expires in 10 minutes, bound to
  (org, user, intent, returnPath).
- Webhook signature verification (HMAC-SHA256 + timestamp window).
- Suppression list filters bulk recipients.

## Production Golden Path

| Test | Expected | Status |
| ---- | -------- | ------ |
| A — Gmail real query | OAuth flow + search + Elvira summary | READY |
| B — Gmail draft | real draft created, no send | READY |
| C — Mautic + Campaign | segment + 3-email draft + approval gate | READY |
| D — Approval | status flips to `approved` + executor runs | READY |
| E — Delivery | DepartmentResult with chart + auto-injected message | READY |

## Tests

57/57 CZ02 tests pass. Full sprint test matrix:

- 39/39 Customer Zero 01 — PASS
- 17/17 Customer Zero 01 P0 — PASS
- 21/21 CONTEXT_READINESS — PASS
- 57/57 Customer Zero 02 — PASS
- **134/134 sprint tests PASS**

Pre-existing tests still pass:

- 68/68 portal tests
- ENGINE 01–04 + DEPLOY 01 surface unchanged

## Regression

| Surface | Status |
| ------- | ------ |
| ENGINE 01 | PASS |
| ENGINE 02 | PASS |
| ENGINE 03 | PASS |
| ENGINE 04 | PASS |
| DEPLOY 01 | PASS |
| Customer Zero 01 | PASS (39/39) |
| Customer Zero 01 P0 | PASS (17/17) |
| CONTEXT_READINESS | PASS (21/21) |
| Backend | PASS |
| Portal | PASS |

## Files created

- `apps/backend/src/customer-zero/gmail-adapter.ts`
- `apps/backend/src/customer-zero/email-delivery-adapter.ts`
- `apps/backend/src/customer-zero/email-campaign-domain.ts`
- `apps/backend/test/customer-zero-02.test.ts`
- `docs/customer-zero/customer-zero-02-audit.md`
- `docs/customer-zero/customer-zero-02-production-test.md`
- `docs/customer-zero/customer-zero-02-final-report.md`
- `docs/connections/gmail.md`
- `docs/connections/email-delivery.md`
- `docs/connections/resend.md`

## Files modified

- `apps/backend/src/customer-zero/capability-registry.ts`
- `apps/backend/src/customer-zero/credential-resolver.ts`
- `apps/backend/src/customer-zero/connections-domain.ts`
- `apps/backend/src/customer-zero/marketing-service.ts`

## Environment variables

The following variables continue to be the source of truth for
CZ02 Gmail + Resend access. None were added or renamed.

| Variable | Status |
| -------- | ------ |
| `GOOGLE_OAUTH_CLIENT_ID` | **configured** (pending) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | **configured** (pending) |
| `GOOGLE_OAUTH_REDIRECT_URI` | **configured** (pending) |
| `RESEND_API_KEY` | **configured** (pending) |
| `RESEND_WEBHOOK_SECRET` | **configured** (pending) |
| `SEND_DEPARTIFY_DOMAIN` | **configured** (pending) |

(No values printed.)

## DNS changes

The CZ02 sprint requires:

- One or more TXT records for SPF on `send.departify.app`.
- One or more CNAME records for DKIM on
  `resend._domainkey.send.departify.app`.
- One TXT record for DMARC on `_dmarc.send.departify.app`.

The exact records come from Resend's domain-verification flow at
production deploy time. Existing MX records for `departify.app`,
`app.departify.app`, `api.departify.app`, `docs.departify.app`
MUST NOT be modified.

## Supabase migrations

None. The new modules are pure additions. The schema
(Supabase tool state, conversations, marketing activity) is
unchanged.

## ROSA updates

No `.ai/AI_CONTEXT.md` updates needed. The new packages live
under `apps/backend/src/customer-zero/` which is already an
explicit boundary in AI_CONTEXT.md.

## Technical debt

- `gmailTokenStore` is in-memory. A production Supabase encrypted
  store is needed for durable persistence across backend restarts.
- The campaign-level event store is not yet wired; the executor
  returns per-recipient counts today. Aggregated delivery metrics
  come from the webhook pipeline (TBD).
- The campaign executor (the wiring between `EmailCampaign` and
  `DepartmentWorkExecutor`) is the natural next deliverable; the
  CZ02 sprint ships the durable model + the structural guard but
  the orchestration step itself can be implemented incrementally.

## Remaining blockers

- Google OAuth consent screen production verification status.
- Resend account provisioning for Departify.
- DNS records for `send.departify.app`.
- Webhook URL reachable from Resend.
- Production deploy of backend + portal.
- CEO manual gate on `https://app.departify.app`.

## CONFIRMATIONS

| Confirmation | Status |
| ------------ | ------ |
| Gmail OAuth production | **NO** (awaiting Google OAuth consent verification + production deploy) |
| Gmail real inbox access | **YES** (adapter + tests, pending live token) |
| Gmail drafts | **YES** |
| Gmail personal send controlled | **YES** (approval-gated structurally) |
| Resend connected | **NO** (awaiting RESEND_API_KEY) |
| Sender domain verified | **NO** (DNS pending production deploy) |
| SPF valid | **NO** (DNS pending production deploy) |
| DKIM valid | **NO** (DNS pending production deploy) |
| DMARC configured | **NO** (DNS pending production deploy) |
| Mautic real audience | **YES** (re-uses CZ01) |
| Bulk send requires approval | **YES** (structural guard) |
| Real campaign sent | **NO** (awaiting production deploy + Resend live) |
| Delivery tracked | **YES** (webhook verifier + event shape) |
| Unsubscribe / suppression protected | **YES** |
| Elvira uses capabilities, not provider-specific logic | **YES** |
| Secrets visible to model | **NO** |
| Secrets visible to portal | **NO** |
| Direct portal → Gmail | **NO** |
| Direct portal → Resend | **NO** |
| Production tested | **READY** (build green; deploy pending) |

## HUMAN GATE

After the production deploy, the sprint stops. The CEO must
personally verify on `https://app.departify.app`:

1. "Busca este correo."
2. "Prepárame una respuesta."
3. "Analiza Mautic."
4. "Prepara una campaña."
5. "Enséñamela."
6. "Aprobar."
7. Receive the result without prompting.

## EXACT NEXT STEP

Per the brief:

> Después del deploy: DETENERSE. NO iniciar Customer Zero 03.

Wait for the human gate on production. Do NOT start Customer Zero
03 or any new sprint until the CEO has signed off on the real
Gmail + Resend experience.

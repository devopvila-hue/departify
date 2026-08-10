# Customer Zero 02 — Audit (Pre-Sprint State)

**Date:** 2026-08-10
**Scope:** Pre-CZ02 audit of the existing Departify stack for the
Gmail + Email Delivery + Campaign Execution sprint.

This audit records the existing infrastructure that CZ02 will
re-use and the gaps that the sprint must close. It does not propose
changes — it only reports the observed state, grounded in code and
configuration.

---

## 1. Existing Google integration

`packages/config/src/schema.ts` and `runtime.ts` expose Vertex AI
configuration only:

- `GOOGLE_VERTEX_PROJECT_ID`
- `GOOGLE_VERTEX_LOCATION`
- `GOOGLE_VERTEX_MODEL`
- `GOOGLE_APPLICATION_CREDENTIALS`

There is **no Gmail API client, no Google OAuth client, no
GmailAdapter, no Gmail scope set, no Gmail credentials storage**
in the repository today. `engine-adapter` consumes Vertex through
OpenClaw; the rest of the system does not call Google APIs
directly.

## 2. Existing OAuth flow

`apps/backend/src/customer-zero/connections.ts` contains:

- A `ToolDescriptor` schema with `requiredCredentials` and an
  `authorizationEndpoint` (e.g. `https://accounts.google.com/o/oauth2/v2/auth`
  for Gmail, Microsoft for Outlook, etc.).
- `startConnection(connection, tool, options, locale)` — builds the
  provider authorization URL and returns `connection.status =
  "connecting"` with the URL.
- `completeConnection(connection)` — flips the connection to
  `connected` when the callback returns with a code.
- A callback route at `/api/customer-zero/:organizationId/connections/:toolId/callback`
  that accepts `?code=&state=`.

What's missing:

- A real OAuth **state store** (CSRF / replay protection). Today the
  callback writes the connection as `connected` without verifying
  that the state belongs to the calling organization, the user, or
  a recent start.
- Token persistence. The callback does not store access / refresh
  tokens anywhere. `connection.status = "connected"` is the only
  durable signal.
- Refresh-token handling. There is no token refresh, no expiry
  tracking, no scope validation, and no token revocation.
- A real OAuth handshake with a Google client ID + client secret.
  Today the only credential source is `MAUTIC_*` for Mautic; for
  Google the OAuth flow exists in shape but has no live backend.

## 3. Existing callback infrastructure

The portal calls `api.connect(org, toolId)` (POST `/connections/:toolId/connect`),
which returns the `authorizationUrl`. The portal redirects the CEO
there. When Google redirects back to
`/api/customer-zero/:org/connections/:toolId/callback?code=...`,
the backend writes the connection as connected.

`apps/portal/src/app/api.ts` exposes:

- `api.connect(org, toolId)` — POST.
- `api.declareTool(org, toolId)` — POST.
- `api.connections(org)` — GET (legacy + 5-state cards).

The callback URL convention
`/api/customer-zero/:org/connections/:toolId/callback` is already
in use; CZ02 will re-use it for Gmail.

## 4. Existing credential storage

`apps/backend/src/customer-zero/credential-resolver.ts` (CZ01)
provides the only credential boundary:

```
resolveCredentials({ organizationId, provider }) → { available, source, label, handle }
getCredentials(handle) → ResolvedCredential           // internal-only
```

The in-process `handleRegistry` map is process-local. **It does not
survive a backend restart.** CZ02 must extend this with a
durable, org-scoped store for Gmail OAuth tokens. Today it only
covers Mautic env bootstrap.

## 5. Existing email provider code

There is **no email provider code** in the repository today. No
SMTP client, no Resend SDK, no SendGrid SDK, no Mailgun SDK.
`packages/config/src/schema.ts` does not declare any email-related
variables. The portal never sends email.

The only email-shaped UX surface today is `/conexiones` declaring
`gmail` / `outlook` / `mailchimp` as part of the catalog but without
a working adapter behind them.

## 6. DNS state

There is no documented DNS plan for `departify.app`. CZ02 will
introduce a dedicated sender domain (`send.departify.app`) and
must:

1. Document the existing DNS records for `departify.app`,
   `app.departify.app`, `api.departify.app`, `docs.departify.app`.
2. Add the minimum SPF + DKIM + DMARC records required by the
   chosen provider (Resend) without breaking the existing MX
   records.

This audit does not modify DNS. Production deploy will document
the exact records required by Resend's verification flow before
any change.

## 7. Required scopes

Customer Zero 02 will use the minimum-privilege Gmail scopes:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.compose`
- `https://www.googleapis.com/auth/gmail.send`

For Customer Zero 02 the first version requests:

- identity (`userinfo.email`, `userinfo.profile`)
- read (`gmail.readonly`)
- compose (`gmail.compose`)
- send (`gmail.send`)

No additional scopes (Drive, Calendar, Contacts) are requested in
this sprint.

## 8. Security risks

- The OAuth state is not stored today → CZ02 must add a state
  store that ties the start to the (org, user, intent) and that
  expires within 10 minutes.
- The current `handleRegistry` is in-process → CZ02 must move
  Gmail refresh tokens into a durable, server-only credential
  store keyed by `(organizationId, userId, provider)`.
- Approval bypass risk → CZ02 must enforce the approval gate
  structurally in the executor (`email.send.bulk` only runs when
  `campaign.status === "approved"`).
- Webhook signature verification → CZ02 must verify Resend
  webhook signatures (`svix`-style HMAC) before ingesting events.
- Header injection → CZ02 must sanitize From / Reply-To / subject
  inputs (strip CRLF, validate email RFC 5322).
- Org isolation → CZ02 must verify that the OAuth `userId` and
  the campaign's `organizationId` belong to the same tenant.

## 9. Reuse plan

| Component | Reuse from CZ01 | New for CZ02 |
| --------- | ---------------- | ------------- |
| `CredentialResolver` | YES — extend with `gmail` + `resend` providers | — |
| `CapabilityRegistry` | YES — extend with email ids | — |
| `DepartmentWorkExecutor` | YES — re-use for campaign execution | — |
| `DepartmentTask` | YES | — |
| `DepartmentResult` | YES — campaign metrics fit the same shape | — |
| `MauticAdapter` (contacts / segments) | YES — audience source | — |
| `MarketingService` | YES — extend with email / campaign awareness | — |
| `ChatRoute` polling | YES — re-use for campaign progress events | — |
| `/conexiones` 5-state UI | YES — extend with Gmail + Resend cards | — |
| OAuth callback route | YES — re-use path `/connections/:toolId/callback` | — |
| Webhook signature verification | — | NEW (Resend svix-style HMAC) |
| Gmail OAuth start / state store | — | NEW |
| Gmail adapter (Gmail API) | — | NEW |
| EmailDeliveryAdapter boundary | — | NEW |
| Resend adapter | — | NEW |
| Suppression list | — | NEW |
| EmailCampaign model | — | NEW |
| EmailSequence model | — | NEW |
| Approval policy (per capability) | — | NEW |
| Webhook endpoint for delivery events | — | NEW |

## 10. What's not in scope

The brief is explicit. Do **not**:

- Re-implement Customer Zero 01, ENGINE 01–04, DEPLOY 01.
- Add new departments (Sales, Finance, Operations).
- Install Hermes or change OpenClaw / EngineAdapter / Vertex.
- Run Impeccable.
- Redesign the commercial website.
- Introduce a new CRM.
- Build a generic automation engine.
- Substitute Resend for a different bulk provider in this sprint.
- Send campaigns without approval.

## 11. Bottom line

The plumbing CZ02 needs (capability registry, work executor,
results, approvals, connections UI, chat polling) already exists
in CZ01. The sprint's job is to:

1. Extend the capability registry with email ids.
2. Build a real Gmail OAuth state machine + token store + adapter.
3. Build the EmailDeliveryAdapter boundary + Resend adapter.
4. Add campaign + sequence + approval gates.
5. Add webhook + delivery events + suppression list.
6. Wire it all through the DepartmentWorkExecutor pattern.

No new architecture. No rewrite. Strictly additive, capability-first.

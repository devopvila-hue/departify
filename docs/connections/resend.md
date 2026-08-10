# Resend — Customer Zero 02

**Status:** First implementation of the EmailDeliveryAdapter boundary.

## Why Resend

- Simple HTTPS API.
- Per-domain SPF / DKIM / DMARC verification.
- Native webhooks for delivered / bounced / complained / opened / clicked.
- Predictable cost structure for Customer Zero bootstrap.
- Substitutable: the boundary accepts a future SendGrid / Mailgun
  adapter without changing MarketingService.

## Production setup

1. **Account + domain**

   - Create the Resend account for Departify.
   - Verify the dedicated sender domain (recommended: `send.departify.app`).
   - Add the SPF, DKIM and DMARC records Resend provides.

2. **API key**

   - Set `RESEND_API_KEY` in Railway (backend) and Netlify (only if
     the portal ever calls Resend directly — it should NOT).
   - Rotate regularly.

3. **Webhook**

   - Set the webhook URL to
     `https://api.departify.app/webhooks/resend`.
   - Configure Resend to sign with a per-endpoint secret.
   - Set the secret in Railway as `RESEND_WEBHOOK_SECRET`.

4. **Sender identity**

   - From: `Elvira <elvira@send.departify.app>` (or the marketing
     equivalent).
   - Reply-To: a corporate address so replies are captured.

## DNS

The exact records come from Resend's domain-verification flow.
Do not invent records. Expected minimum:

- One or more **TXT** records for SPF (`v=spf1 include:resend.com ~all`).
- One or more **CNAME** records for DKIM (`resend._domainkey.send.departify.app`).
- A **TXT** record for DMARC (`_dmarc.send.departify.app`) with a
  conservative policy (e.g. `p=quarantine; rua=mailto:dmarc@departify.app`).

MX records for `send.departify.app` are NOT required (it is a
sender-only subdomain). Do NOT modify existing MX records for
`departify.app` / `app.departify.app` / `api.departify.app` /
`docs.departify.app`.

## API surface used

- `POST /emails` — send single + bulk (one call per recipient).
- `GET /domains/{domain}` — verifyDomain status (SPF / DKIM / DMARC).
- `GET /emails/{id}` — per-message status (read receipt).
- Webhooks: `email.delivered`, `email.bounced`, `email.complained`,
  `email.opened`, `email.clicked`, `email.failed`.

## Security

- API key never logged, never serialized, never sent to the portal
  or the model. Resolved exclusively through `CredentialResolver`.
- Webhook signatures verified with HMAC-SHA256 + timestamp window.
- From / Reply-To / subject / recipient addresses are sanitized
  before any provider call.
- Bulk send requires structurally approved campaign.

## Open production blockers

- Resend account provisioning for Departify (no values committed).
- DNS records for `send.departify.app` (no production record set yet).
- Webhook URL reachable from Resend (`api.departify.app/webhooks/resend`).

These are documented in `docs/customer-zero/customer-zero-02-production-test.md`.
The CZ02 sprint is technically ready; the production gate is the
manual verification step after the CEO signs off on `app.departify.app`.

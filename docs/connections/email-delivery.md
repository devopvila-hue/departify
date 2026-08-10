# Email Delivery — Customer Zero 02

**Status:** Production-ready bulk email delivery boundary.

The EmailDeliveryAdapter is the Departify-owned boundary the
Marketing campaign executor depends on. The first implementation is
Resend; the boundary is shaped so a future SendGrid / Mailgun
adapter can plug in without touching MarketingService or the
campaign executor.

## 1. Architecture

```
EmailDeliveryAdapter (boundary)
    ├── ResendEmailDeliveryAdapter  (today)
    ├── SendGridEmailDeliveryAdapter (future)
    └── MailgunEmailDeliveryAdapter  (future)
```

MarketingService + the campaign executor depend only on the
interface (`verifyDomain`, `sendSingle`, `sendBulk`,
`getMetrics`) — never on the Resend SDK.

## 2. Capabilities

| Capability id | Description |
| ------------ | ----------- |
| `email.send.bulk` | Send a bulk email campaign. |
| `email.delivery.read` | Read delivery status / metrics. |
| `email.bounce.read` | Read bounce and complaint events. |
| `email.campaign.read` | Read campaign status. |
| `email.campaign.execute` | Execute a campaign (approval-gated). |

## 3. Normalized types

Departify-owned shapes in
`apps/backend/src/customer-zero/email-delivery-adapter.ts`:

```
DomainAuthenticationStatus {
  domain, spf: "valid"|"missing"|"invalid",
  dkim: "valid"|"missing"|"invalid",
  dmarc: "valid"|"missing"|"invalid",
  verifiedAt, providerState
}

DeliverySendInput { from, to, subject, html, text?, replyTo?, tags?, headers?, idempotencyKey? }
DeliverySendResult { providerMessageId, accepted, sentAt }

BulkDeliverySendInput { campaignId, from, replyTo?, subject, html, text?,
                        recipients[], suppressions[], tags? }
BulkDeliverySendResult { accepted, rejected[], sentAt }

DeliveryEvent {
  provider, providerMessageId, campaignId, kind: "delivered"|"bounced"|"complained"|"opened"|"clicked"|"failed",
  recipient, occurredAt, raw
}

DeliveryMetrics { campaignId, sent, delivered, bounced, complained, opened?, clicked? }
```

## 4. Approval gate (structural)

`email.send.bulk` is only invoked by the campaign executor when
`campaign.status === "approved"`. The check is structural — the
executor will not send otherwise. The brief:

> bulk send impossible sin aprobación

is enforced in `canSendCampaign(status)` and at every call site
of `BulkDeliverySendInput`.

## 5. Suppression

The campaign executor passes the suppression list into
`sendBulk.suppressions`. The adapter:

1. Filters recipients against the suppression set.
2. Adds suppressed recipients to `result.rejected` with reason
   `"suppressed"`.
3. Skips the provider call entirely for those recipients.

The suppression list is per-org and persisted in
`suppressionStore`. Reasons: `unsubscribed`, `hard_bounced`,
`complained`, `manual`. Email addresses are lower-cased before
matching.

## 6. Webhook verification

Resend webhooks are signed with HMAC-SHA256 under a per-endpoint
secret. The verifier accepts both:

- `svix-signature` / `svix-timestamp` headers (newer Resend
  deployment).
- `Resend-Signature` / `Resend-Timestamp` headers (older).

`verifyResendWebhook({ rawBody, headers, secret })` performs:

1. Timestamp window check (default 5 minutes tolerance).
2. HMAC-SHA256 computation over `${timestamp}.${rawBody}`.
3. Constant-time comparison against the signature header,
   stripping any `v1,` prefix.
4. JSON parsing of the body.
5. Event-kind classification.
6. Returns a normalized `DeliveryEvent`.

The verifier fails closed — invalid signature, missing header,
or unknown event type produces a thrown `EmailDeliveryError`.

## 7. Security

- API key resolved exclusively through `CredentialResolver`. Never
  serialized, logged, or returned to the portal.
- From / Reply-To / subject / recipient addresses are sanitized
  before provider calls (CR/LF stripped, RFC 5322 validated).
- Suppression filter prevents resend to unsubscribed / hard
  bounced / complained addresses.
- Bulk send requires structurally approved campaign.

## 8. Required environment variables

```
RESEND_API_KEY
SEND_DEPARTIFY_DOMAIN  # e.g. "send.departify.app"
```

No values are committed. The production deploy will set them via
Railway secrets.

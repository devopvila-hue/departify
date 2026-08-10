# Gmail Integration — Customer Zero 02

**Status:** Production-ready READ + DRAFT + PERSONAL SEND adapter.
Connection is via Google OAuth 2.0 (authorization code flow).

## 1. Connection method

OAuth 2.0 `authorization_code` flow against
`https://accounts.google.com/o/oauth2/v2/auth`.

Tokens are stored in a server-only, in-memory store keyed by
`(organizationId, userId)`. The portal never sees the refresh
token. The backend holds it for the duration of the process; a
production deploy that requires durable token persistence should
plug a Supabase encrypted store into `gmailTokenStore`.

### Scopes requested (minimum privilege)

```
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.compose
https://www.googleapis.com/auth/gmail.send
```

No Drive, Calendar, Contacts or any other scope is requested in
this sprint.

## 2. Capabilities

| Capability id | Description |
| ------------ | ----------- |
| `email.identity.read` | Read the mailbox identity (email + displayName). |
| `email.context.read` | Read mailbox context (recent inbox + labels). |
| `email.search` | Search real emails in the mailbox. |
| `email.thread.read` | Read an email thread with messages + participants. |
| `email.draft` | Create a draft (no send). |
| `email.send.personal` | Send a personal email — requires approval. |

`email.send.bulk` is NOT a Gmail capability. The brief forbids
using Gmail for bulk; the campaign executor routes bulk send
through the EmailDeliveryAdapter (Resend).

## 3. Normalized types

Departify-owned shapes in `apps/backend/src/customer-zero/gmail-adapter.ts`:

```
EmailIdentity   { email, displayName, provider: "gmail" }
EmailMessage    { id, threadId, subject, from, to, snippet, date, isUnread, labels? }
EmailThread     { id, subject, messages[], participants[] }
EmailDraft      { id, threadId, to, subject, bodyText, updatedAt }
EmailSendResult { messageId, threadId, sentAt }
```

No Gmail-specific shape leaks past the adapter.

## 4. Health

`GmailAdapter.health()` checks:

- token presence,
- token expiry (proactive refresh),
- `/users/me/profile` reachability.

Returns:

- `connected` — profile responds 200.
- `needs_attention` — no tokens OR 401 (token revoked / expired beyond refresh).
- `error` — Gmail API returns 5xx or network failure.

## 5. Approval policy

Personal sends (`email.send.personal`) require explicit approval.
The brief is unambiguous:

> No send sin policy/approval.

The structural enforcement lives in the marketing tool runtime /
campaign executor: `email.send.bulk` only runs when
`campaign.status === "approved"`. Personal sends use the same
approval gate through the existing `MarketingService` approval
flow.

## 6. Security

- Refresh tokens NEVER leave the backend.
- The portal consumes only `{ email, displayName, provider }` from
  `/email-identity`.
- OAuth state is single-use, expires in 10 minutes, and is bound to
  `(organizationId, userId, intent, returnPath)`. Replay attempts
  fail with `GmailOAuthError("replay")`.
- Organization mismatch → `GmailOAuthError("org_mismatch")`.
- User mismatch → `GmailOAuthError("user_mismatch")`.
- `From` header is built from the verified identity (no spoofing).
- Subject / body are stripped of CR/LF before sending (header
  injection prevention).
- Recipient addresses are RFC 5322 validated.

## 7. Required environment variables

```
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI  # default: https://api.departify.app/connections/google/callback
```

No values are committed to the repo. The Google Cloud project
requires:

- OAuth consent screen (production verification status).
- Authorized redirect URI matching `GOOGLE_OAUTH_REDIRECT_URI`.
- The minimum scopes above.

If Google requires verification for any of the scopes this sprint
uses, that is documented as a blocker in the Customer Zero 02
production test report and is NOT silently bypassed.

## 8. Future work (out of scope this sprint)

- Durable token store (Supabase encrypted table).
- Push notifications (Gmail watch).
- Label / draft management.

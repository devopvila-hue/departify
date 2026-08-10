# Mautic Integration — Customer Zero 01

**Status:** Production-ready READ-ONLY adapter.

## 1. Connection method

OAuth2 `client_credentials` flow against the Mautic REST API.

Bootstrap (Customer Zero): the backend reads
`MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`, and `MAUTIC_CLIENT_SECRET`
from the environment. The portal shows "Conectado mediante
configuración del sistema" without exposing the secret values.

Future: per-org Supabase encrypted store (same `CredentialResolver`
boundary; no caller changes).

## 2. Capabilities

| Capability id | Tool id | Description |
| ------------- | ------- | ----------- |
| `crm.contacts.read` | `mautic.contacts.list`, `mautic.contacts.count`, `mautic.contacts.summary` | Aggregate reads of the CRM contact base. |
| `crm.contacts.list` | `mautic.contacts.list` | Paginated read. |
| `crm.contacts.search` | `mautic.contacts.search` | Search by name / email. |
| `crm.contact.read` | `mautic.contacts.get` | Single contact by id. |
| `crm.contacts.summary` | `mautic.contacts.summary` | Executive summary: totals + stale contacts + top segments. |
| `crm.segments.read` | `mautic.segments.list` | All CRM segments. |
| `crm.segments.list` | `mautic.segments.list` | Same as above. |
| `crm.campaigns.read` | `mautic.campaigns.list` | All CRM campaigns. |
| `crm.campaigns.list` | `mautic.campaigns.list` | Same as above. |
| `crm.activity.read` | `mautic.contact.activity` | Per-contact activity (when the endpoint is exposed). |

All capabilities are READ-ONLY. The capability contract carries
`riskLevel: "read"` and `approvalPolicy: "auto"` — no CEO approval is
required to execute them.

## 3. Normalized types

The adapter maps Mautic payloads to Departify-owned types in
`apps/backend/src/customer-zero/mautic-types.ts`:

```
CRMContact {
  id, displayName, email?, company?, tags?, segments?,
  createdAt?, lastActivityAt?, score?, status?
}

CRMContactPage { total, contacts[], nextOffset? }

CRMSegment { id, name, description?, contactCount? }

CRMCampaign { id, name, description?, status?, isPublished? }

CRMActivity { id, contactId, type, name, timestamp, details? }

CRMSummary {
  totalContacts, totalSegments, totalCampaigns,
  contactsWithoutRecentActivity?, topSegments?
}
```

Only fields actually verified to exist on the Customer Zero
instance are populated; the rest stay `undefined`. The adapter
never invents data.

## 4. Health

`mautic.test_connection` (tool id) calls `testMauticConnection`:

1. POST `/oauth/v2/token` with `grant_type=client_credentials`.
2. If 200, GET `/api/users/self` with the bearer token.
3. Returns `{ success, message, serverInfo: { version, name } }`.

`POST /api/customer-zero/:org/connections/mautic/test` exposes the
same check at the API layer and updates the durable tool state:
- `connected` → `verifiedAt = now`, `health = operational`.
- `auth failure` → `degraded`, CTA "Revisar conexión".
- `unavailable` → `unavailable`.

## 5. Errors

The adapter classifies Mautic errors into:

- `auth` — invalid client / 401.
- `rate_limit` — 429.
- `unavailable` — 5xx / network timeout.
- `invalid_response` — unexpected shape.

Tools return `{ success: false, errorCode, message }` to the Tool
Runtime; the portal renders a business-language message ("Elvira no
ha podido acceder a Mautic en este momento") and never shows stack
traces or raw Mautic payloads.

## 6. Limits

- `mautic.contacts.list`: `limit` capped at 200 per page.
- `mautic.contacts.summary`: 100 contacts per snapshot; threshold
  default 60 days.
- `mautic.test_connection`: timeout 15s.
- `mautic.contacts.list` / `get`: timeout 15-20s.

## 7. Security

- Secrets are loaded via `CredentialResolver` — the LLM never sees
  the client secret.
- Token requests include a native `AbortSignal` adapter so tool
  cancellation propagates correctly.
- Error messages are truncated to 200 chars.

## 8. Future work (out of scope this sprint)

- Write actions (create / update / delete contacts, launch campaigns).
  These would carry `riskLevel: "write"` and `approvalPolicy:
  "ceo_required"`.
- Webhook listener for Mautic → Departify activity stream.
- Per-org credential storage in Supabase.

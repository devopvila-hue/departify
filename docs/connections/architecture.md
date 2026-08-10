# Connections Architecture — Customer Zero 01

**Scope:** Departify-owned connection layer for Customer Zero 01.

## 1. Conceptual model

The CEO never thinks in "plugins". They think in capabilities:

- "Quiero consultar los contactos del CRM."
- "Quiero enviar un email."
- "Quiero ver la analítica web."

Departify translates those capabilities into a provider (Mautic, Gmail,
Google Analytics, …) and resolves credentials behind the scenes.

### 1.1 Types

```
ConnectionDefinition
  id, name, category, logoMark, brandColor, capabilities[], configSourceLabel

ConnectionInstance (per organization)
  organizationId, provider, state, lastCheckedAt, verifiedAt, capabilities[]

ConnectionState (5-state business model)
  not_connected | connecting | connected | needs_attention | error

CapabilityDefinition
  id, nameEs, nameEn

CapabilityAvailability
  capability, available, providers[]

CredentialReference (opaque)
  handle = { id, provider, source: "environment" | "secure_store", resolvedAt }
```

The `handle` is the only thing that crosses the backend → adapter
boundary. The raw secret value NEVER crosses any boundary except the
internal `getCredentials(handle)` call.

## 2. CredentialResolver

`apps/backend/src/customer-zero/credential-resolver.ts`

```
resolveCredentials({ organizationId, provider }) → CredentialResolution
getCredentials(handle) → ResolvedCredential        // internal-only
publicCredentialSource(...) → { available, label, source }  // safe-for-portal
```

Sources are tried in priority order:

1. org-scoped secure credential store (future — Supabase encrypted
   table, not yet wired).
2. environment variables (Customer Zero bootstrap).
3. Runtime secret source permitted by architecture.
4. Never the frontend.

Today, Mautic is the only provider with a working source — it reads
`MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET` from the
backend env and returns `source: "environment"`, `label: "env:mautic"`.

## 3. CapabilityRegistry

`apps/backend/src/customer-zero/capability-registry.ts`

Static, capability-first mapping:

```
crm.contacts.read    → provider: mautic, toolIds: [mautic.contacts.list, ...]
crm.segments.read    → provider: mautic, toolIds: [mautic.segments.list]
crm.campaigns.read   → provider: mautic, toolIds: [mautic.campaigns.list]
...
```

API:

```
isCapabilityAvailable(orgId, capability) → CapabilityAvailability
listReadyCapabilities(orgId)            → BusinessCapability[]
listAvailableCapabilities(orgId)         → CapabilityAvailability[]
```

The CapabilityRegistry is the single seam where new providers can
plug in without changing MarketingService or Elvira. Adding a new
provider means: add a `CapabilityDescriptor`, add a credential
source, register the tool in the Tool Runtime.

## 4. Mautic adapter

`apps/backend/src/customer-zero/mautic-adapter.ts`

Thin HTTP client. Read-only. Normalized to Departify-owned types
defined in `mautic-types.ts`:

- `CRMContact`, `CRMContactPage`
- `CRMSegment`
- `CRMCampaign`
- `CRMActivity`
- `CRMSummary`

Endpoint summary:

| Method | Endpoint | Tool id |
| ------ | -------- | ------- |
| `testMauticConnection` | `/oauth/v2/token` + `/api/users/self` | `mautic.test_connection` |
| `getMauticContactCount` | `/api/contacts?limit=1` | `mautic.contacts.count` |
| `searchMauticContacts` | `/api/contacts?search=…&limit=10` | `mautic.contacts.search` |
| `listMauticContacts` | `/api/contacts?limit=&start=&orderBy=` | `mautic.contacts.list` |
| `getMauticContact` | `/api/contacts/:id` | `mautic.contacts.get` |
| `listMauticSegments` | `/api/segments?limit=200` | `mautic.segments.list` |
| `listMauticCampaigns` | `/api/campaigns?limit=200` | `mautic.campaigns.list` |
| `getMauticContactActivity` | `/api/contacts/:id/activity` | `mautic.contact.activity` |
| `getMauticSummary` | composite | `mautic.contacts.summary` |

## 5. Connections API

| Endpoint | Method | Notes |
| -------- | ------ | ----- |
| `/api/customer-zero/:org/connections` | GET | Returns 5-state cards + legacy view. |
| `/api/customer-zero/:org/connections/:provider` | GET | Single connection. |
| `/api/customer-zero/:org/connections/:provider/test` | POST | Live health probe. |
| `/api/customer-zero/:org/capabilities` | GET | Aggregated business capabilities. |

## 6. UI surface

`/conexiones` (`apps/portal/src/routes/ConnectionsRoute.tsx`):

- Five-state grid with brand marks (no remote logos, no fake assets).
- Per-state action CTA:
  - connected → "Comprobar conexión"
  - needs_attention / error → "Revisar conexión"
  - not_connected + env present → "Activar"
  - not_connected + no env → "Configurar"
- When `state === "connected"` and `configSource = "env:mautic"` the
  card displays "Conectado mediante configuración del sistema" (no
  raw credentials, no client id, no password).

## 7. Future-proofing

- Replace `environment` source with Supabase encrypted store:
  `CredentialResolver` returns `source: "secure_store"`; the rest of
  the system is unchanged.
- Add a new provider: register the CapabilityDescriptor, the
  ToolDefinition, the adapter, and the secure-store bridge.
- Add Mautic write capabilities: add `writeActions` to the Mautic
  capability contract; the rest of the system continues to route
  through the Tool Runtime with `riskLevel: "write"` and explicit
  approval.

## 8. Security guarantees

- Raw secrets never serialize to JSON, log, or HTTP responses.
- Portal consumes only `{ available, source: "environment", label:
  "env:mautic", handle }`.
- Adapter receives the secret via the internal `getCredentials(handle)`.
- Tool Runtime exposes capabilities as business names; tool ids and
  credentials never reach the LLM context.
- Org isolation: per-(org, department) engine session; tool state
  is keyed by `(organizationId, toolId)`.

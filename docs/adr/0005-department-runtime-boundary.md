# ADR 0005 — Department Runtime Boundary

## Status

Accepted.

## Date

2026-08-09.

## Context

ENGINE 03 makes Marketing the first fully functional department. The CEO must
experience Elvira (Directora de Marketing) as a business executive: she
understands the company, sets plans, forms teams, requests approvals, reports
activity and produces results. All of her cognitive work must run through the
provider-independent engine boundary introduced in ENGINE 02
(`packages/engine-adapter`), never through a direct OpenClaw/Vertex call or a
parallel runtime.

The existing Customer Zero runtime already composes a rich Marketing pipeline
(marketing-director deterministic engines, discovery business context, tool
runtime, capability registry, durable conversations). This ADR decides how a
Departify-owned Department service sits between the backend and the engine
without duplicating or bypassing that work.

## Decision

- A **MarketingService** (`apps/backend/src/customer-zero/marketing-service.ts`)
  is the single Departify-owned service for the Marketing department. It owns:
  - objectives (`BusinessObjective`), activity ledger, approvals, digital
    employees, and connected tools (business-language domain model in
    `marketing-domain.ts`);
  - routing ALL of Elvira's cognitive work through the **EngineAdapter**
    (`createSession` + `sendMessage` → OpenClaw → Vertex);
  - a per-(organization, department) engine session (`departify:marketing:<org>`)
    so multi-turn memory is real and isolated between companies.
- The **Command Center** `delegate_marketing` decision calls the MarketingService
  when an engine is configured; otherwise it falls back to the legacy
  `marketing.chat` tool so pre-engine environments keep working.
- The **legacy Customer Zero runtime** is FROZEN as the business-context and
  discovery source of truth (`DiscoveryReportRepository` → `buildBusinessContext`).
  It is NOT the engine path for new conversation.
- The portal consumes **business-language** department endpoints
  (`/api/departments/marketing/:org/*`) and a Control Plane
  (`/inicio`, `ControlPlaneRoute`) — no OpenClaw/agent/skill/tool-runtime
  terminology.

## Boundary

```
Departify Portal (Control Plane, Marketing detail, Approvals, Chat)
        ↓ business-language HTTP
Departify Backend
        ↓
MarketingService          (objectives, activity, approvals, employees, tools)
        ↓
EngineAdapter             (packages/engine-adapter — provider-independent)
        ↓
OpenClawEngineAdapter → OpenClaw Gateway → Vertex AI (gemini-2.5-flash)
```

## Current implementation

- `MarketingService` + `marketing-domain.ts` (Departify-owned business model).
- `MarketingService.talkToElvira()` builds Elvira's system context (business
  DNA + current objective + constraints), sends through
  `EngineAdapter.sendMessage`, and records activity + approvals.
- Engine session per (org, department): `createSession({ sessionId:
  "marketing:<org>" })` → OpenClaw session `departify:marketing:<org>`.
- Routes: `/api/departments/marketing/:org` (status), `/objectives`,
  `/message`, `/activity`, `/approvals`, `/approvals/:id`, `/employees`,
  `/tools`.
- Portal: `ControlPlaneRoute` (TU EMPRESA org chart), evolved `MarketingRoute`
  (department detail + integrated Elvira chat), `DecisionsRoute` (approvals
  inbox), sidebar "Tu empresa".

## Future possibilities

- Additional departments (Sales, Finance, Operations) each with their own
  DepartmentService behind the same boundary.
- A native engine or HermesEngineAdapter swaps in without touching
  MarketingService or the portal (the EngineAdapter is the seam).
- Multi-department coordination (CEO intent → route to the right department).

## Consequences

- All Elvira cognitive work flows through EngineAdapter; no direct OpenClaw or
  Vertex calls from Marketing or the frontend.
- OpenClaw remains invisible to the customer (business-language UI only).
- Digital employees are presented as business roles (12 empleados digitales),
  not agents/skills.
- Marketing is the first Golden Department candidate; adoption is confirmed
  only after deployment.
- The legacy Customer Zero runtime stays as discovery/context source; it is not
  deleted or rewritten.

## Security

- `OPENCLAW_GATEWAY_TOKEN` stays backend-only; never sent to the portal.
- Engine errors are normalized to `EngineError` taxonomy; the portal sees clean
  business-language responses.
- Connected tool states are truthful ("No conectado"), never faked.

## Observability

- Per-operation fields: organizationId, departmentId, operation, durationMs,
  status, provider, model, token usage, toolCallsCount.
- The Control Plane / Marketing detail render real backend data only; no
  fabricated company numbers.

## Compatibility

- Backend regression: 175/175 PASS (152 pre-existing + 23 ENGINE 03).
- Engine adapter regression: 18/18 integration PASS; 20/20 unit PASS.
- Portal regression: 68/68 PASS (45 pre-existing + 23 ENGINE 04).
- ENGINE 01 healthz/readyz: 200; engine container healthy.
- Marketing landing / commercial website: untouched. Hermes not installed.

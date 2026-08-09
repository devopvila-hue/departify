# ENGINE 03 — Marketing / Elvira Audit

Status: AUDIT — read before implementing ENGINE 03.

## Estado actual

- **Runtime**: OpenClaw Gateway (`departify-engine`, `127.0.0.1:18889`) + Google Vertex AI (`google-vertex/gemini-2.5-flash`, project `radar-503418`, region `us-central1`). Validated in ENGINE 01 (PASS).
- **Boundary**: `packages/engine-adapter` provides the provider-independent `EngineAdapter` (createSession, sendMessage, getSession, getHistory, closeSession, getUsage, getToolState, health). Validated in ENGINE 02 (PASS, 18/18 integration).
- **Backend**: `apps/backend` composes the Customer Zero runtime (`customer-zero-session.ts`) with: marketing-director package (diagnosis, team formation, capability catalog), Core Tool Catalog (`marketing.chat`, `marketing.work`, discovery tools), Tool Runtime + Mautic tools, DepartmentCapabilityRegistry, memory store, conversations store.
- **Elvira today**: identified in `department-identity.ts` (Marketing head, `agent_marketing_director`). Chat currently flows: `command-center/message` (v2) OR legacy `marketing/messages` (v1) → `session.port.executeAction(toolId:"marketing.chat")` → LLM Router → OpenAI-compatible provider.
- **Portal**: React/Vite. Surfaces: Chat (Home/Command Center), Tareas, Departamentos, Conexiones, Aprobaciones, Resultados, Empresa, Configuración. `MarketingRoute` exists as a workspace. `api.ts` is a thin typed client with business language only.
- **Business context**: onboarding → discovery pipeline → `CompanyDNA` report stored in the in-memory `DiscoveryReportRepository`. `buildBusinessContext()` serializes it into the `marketing.chat` system prompt.
- **Objectives**: the CEO's `goal` travels from onboarding → `session.state.onboarding.goal` → `marketingWork.goal`. There is no first-class `BusinessObjective` entity with status/progress.
- **Activity/approvals/results**: derived from `marketingWork.items` states (`pending/running/completed/needs_approval/approved/unavailable/failed`) via `ceo-overview.ts`. Existing but tied to work items, not a standalone auditable activity ledger.
- **Connected tools**: `connections.ts` + `tool-state.ts` + Mautic tools. Honest states (`not_connected/connecting/connected/blocked`).

## Qué reutilizar

- `packages/engine-adapter` (EngineAdapter + OpenClawEngineAdapter) — the ONLY runtime boundary.
- `packages/marketing-director` deterministic engines (capabilities, specialists/team, diagnosis, gap analysis) — pure business logic, no LLM.
- `department-identity.ts` (Elvira) + `locale.ts` + `ceo-overview.ts` + `command-center.ts` routing.
- `DiscoveryReportRepository` business context (`buildBusinessContext`).
- Conversation store (durable), tool state store, connections catalog.
- Portal `api.ts` pattern, `MarketingRoute`, `HomeRoute` (Command Center), `primitives.tsx`, `tokens.css`.

## Qué congelar

- The legacy `marketing.chat` → LLM Router path is FROZEN for new cognitive work. It may remain reachable for backward compatibility but ENGINE 03 routes all new Elvira conversation through `EngineAdapter`.
- The Customer Zero discovery/onboarding runtime stays as the business-context source of truth.
- Frontend visual identity (blue/black/green, tokens.css) is preserved.

## Qué sustituir

- **Elvira chat path**: `marketing.chat` via Tool Runtime/LLM Router → replaced by a Marketing Service that calls `EngineAdapter.sendMessage` (OpenClaw → Vertex) with the same business context + conversation history + Elvira system prompt. The Command Center `delegate_marketing` decision is the entry point.
- **Objective handling**: introduce a first-class `BusinessObjective` (id, department, title, description, desiredOutcome, constraints, status, createdAt, createdBy, owner, progress) replacing the ad-hoc `onboarding.goal` → `marketingWork.goal` string.
- **Activity**: introduce a durable activity ledger (business-language events: objective received, plan created, analysis done, campaign proposed, approval requested, tool used, result generated, objective updated) instead of only deriving from work items.

## Qué falta para E2E

1. A `MarketingService` that owns objectives, activity, approvals, connected tools and routes conversation through `EngineAdapter`.
2. Elvira system context (professional Marketing Director persona) injected into `EngineAdapter.sendMessage`.
3. Multi-turn memory: the engine session per department per organization carries the conversation; business context + objective + constraints are included each turn.
4. Approval model + API + minimal UI actions.
5. Marketing API (GET/POST) for department, activity, objectives, approvals, employees, connected tools.
6. Portal Control Plane (ENGINE 04): org chart, department cards, Elvira drawer, marketing detail, approvals inbox, activity feed, company status.

## Riesgos

- Vertex quota (429) during burst tests — bounded retries already in EngineAdapter.
- Multi-turn context must be carried by the engine session (not rebuilt each turn). Use one EngineAdapter session per (organization, department) mapped to the CEO's conversation.
- Don't leak OpenClaw/agent/tool terminology to the CEO UI.
- Don't regress ENGINE 01/02 (health, sessions, adapter tests).

## Decisión de implementación

- Keep the Customer Zero runtime for discovery/business-context, but route ALL new Elvira cognitive work through `EngineAdapter` via a new `MarketingService` in `apps/backend/src/customer-zero/`.
- Reuse `buildBusinessContext` + marketing-director capabilities for the system prompt and digital-employee labels.
- Add first-class objectives, activity ledger, approvals, and connected-tools to the service; expose them via new/consolidated API endpoints under the existing Customer Zero route family.
- The Command Center (`delegate_marketing`) calls the Marketing Service (which calls EngineAdapter), preserving the single CEO chat.

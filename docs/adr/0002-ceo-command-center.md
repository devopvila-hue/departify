# ADR 0002: CEO Command Center — Sprint 58

## Status

Accepted.

## Date

2026-08-08.

## Context

The founder's human test of Customer Zero revealed that the value of the
product collapsed the moment the CEO was asked to operate the internal
architecture (departments, agents, employees, tools, connectors). The
founder stopped being a CEO and became an operator.

The product decision was frozen: the CEO talks to DEPARTIFY. There is one
chat. The CEO never chooses a department, agent, employee, tool, or
connector. The Command Center decides who works.

## Decision

Introduce a single conversational surface — the **Command Center** — that
classifies free-form CEO messages into structured routing decisions and
delegates to the existing composed runtime. Specifically:

- A new pure module `apps/backend/src/customer-zero/command-center.ts`
  classifies a CEO message into a `RoutingDecision` discriminated union
  (`greeting`, `request_approval`, `request_connection`, `explain_work`,
  `explain_existing_result`, `summarize_company`, `unknown_department`,
  `delegate_marketing`).
- Two new endpoints expose the Command Center:
  - `GET  /api/customer-zero/:org/command-center/opening`
  - `POST /api/customer-zero/:org/command-center/message`
- The transcript is the existing `session.state.conversation` array the
  Customer Zero flow already uses. The opening endpoint emits structured
  business events (department active, work update, approval request,
  result, connection need) that the portal renders as cards.
- The Home route (`/inicio`) is the canonical Command Center. The
  Marketing route still exists but is no longer a primary chat; it
  exposes a "Preguntar sobre esto" action that opens the Command Center
  with a contextual message.
- Mautic is now a real CRM candidate in the connector catalog
  (`MAUTIC_BASE_URL`, `MAUTIC_CLIENT_ID`, `MAUTIC_CLIENT_SECRET`).
  Integration discovery replaces the previous "no soportado" message: the
  CEO sees a WHY, the required credential shapes, and a connectable
  status. The secrets never enter the suggestion payload.

## Consequences

- The CEO no longer needs to navigate to `/marketing` to talk to Elvira.
- The Marketing route becomes a workspace: team, work, results, tools.
- Multi-department routing is representable in the structured outcomes
  (`departments`, `multiple_departments_note`); only Marketing is active.
  Future departments (Ventas, Finanzas, Operaciones) are honest about
  being `future` status; the router explicitly returns
  `unknown_department` for finance / sales / payroll queries instead of
  simulating them.
- No new packages were created. The Command Center lives in
  `apps/backend/src/customer-zero/` (the existing Customer Zero boundary
  that already composes the Executive Orchestrator, Marketing Director,
  Tool Runtime, and Agent Tool Bridge). The portal surfaces are updates
  to existing routes.
- The Marketing Director V1 (`@departify/marketing-director`) remains
  untouched — it is consumed as the sink for free-form strategy
  questions via the existing `marketing.chat` Core Tool. No
  `marketing.chat` rewrite, no new Director, no `ElviraBrain`.
- The connector catalog now ships four new connectors (Mautic,
  Mailchimp, Slack, Notion) with the documented credential shape but
  `connectable: false` — the secure OAuth handshake for each remains
  out of scope for this sprint. The UX is honest: the CEO sees WHY
  and what's needed, not a fake connection.
- Secrets never reach the LLM context, the transcript, or the Company
  DNA. The `ConnectionSuggestion` payload exposes only credential
  variable names (e.g. `MAUTIC_CLIENT_ID`), never values.
- Architecturally the Chief of Staff / command-center pattern is now
  the entry point for any future Department. Adding a new Department
  means: (a) implementing its template, (b) registering it in the
  router so the routing decision can reference it. Marketing Director
  V1 is the reference implementation; the same shape will apply to
  the next department.

## Compatibility

- Existing routes (`/api/customer-zero/:org/marketing`, `/marketing/work`,
  `/marketing/messages`) remain unchanged. The legacy marketing chat
  endpoint is preserved for backward compatibility.
- All existing Marketing Director V1 contracts remain unchanged; the
  Command Center composes them.
- All existing Marketing tests (`test/command-center.test.ts` plus the
  unchanged backend tests) are green.
- No new packages, no new runtime, no new OpenClaw dependency, no
  changes to `opencloud-client`.

## Compliance

- ROSA: no package boundaries added. `/apps/backend/src/customer-zero/`
  is the existing Customer Zero boundary. Routing logic is a pure
  function — easy to test, easy to reason about, easy to extend.
- Sprint 58 is the V1 of the Command Center. Future sprints will
  grow the connector catalog, add secure OAuth handshakes per
  provider, and add new departments one at a time.

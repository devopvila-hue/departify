# Engine 02 routing inventory

The Runtime Business Context + Capability Bridge adds a normalized business
surface without removing the deterministic safety paths.

## Keep as authoritative safety/state-machine fast paths

- Tenant authentication and organization scoping.
- Capability availability derived from verified connection state.
- Explicit email/calendar approval, cancellation, and edit handling.
- Provider operation verification, idempotency, execution receipts, and
  `accepted_unverified` outcomes.
- Pending email/calendar recovery and current-operation hydration.
- Durable tasks, results, approvals, Company DNA, and bounded conversation
  context.
- Backend-owned execution: OpenClaw can select a normalized tool, but the
  backend authorizes and executes it.

## Keep as fallback during migration

- `routeCommandCenter` and its intent routing for non-operational messages,
  engine fallback, and compatibility with existing clients.
- Existing provider-specific adapters and parsers behind the normalized tool
  executor.
- Semantic phrase classifiers such as email/calendar/Drive request detection,
  until Founder validation proves the runtime bridge handles the equivalent
  turns reliably.

## Deprecate after Founder validation, then remove by evidence

- Phrase patches whose only purpose is to teach the router another wording for
  an already-registered business operation.
- Duplicated intent branches that merely map a natural-language request to a
  provider tool instead of a `departify.*` capability.

## Remove now

None. The migration must not delete a safety, authorization, receipt, or
provider-verification path before real OpenClaw and Founder validation cover
the replacement.

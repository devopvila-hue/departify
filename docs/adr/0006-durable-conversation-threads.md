# ADR 0006: Central Chat uses durable conversation threads — Company DNA, department memory and business work remain separate

## Status

Accepted (P0 architectural requirement).

## Date

2026-08-10.

## Context

Departify's central chat is the primary CEO experience. The Command Center
(ADR 0002) established ONE conversational surface and the CEO never routes
work manually. Customer Zero 03 is shipping Google Workspace + Unified Inbox
and will persist connection + inbox state.

The founder decision is: Departify MUST NOT have one infinite eternal chat.
The CEO must be able to create a new chat, return to previous chats, rename
them, archive them, and continue a clean conversation WITHOUT losing company
knowledge. A new chat does not mean a new company context.

Departify distinguishes FOUR concepts that must never be collapsed into one:

1. **Company DNA** — long-lived company knowledge (identity, business model,
   products, market, positioning, objectives, declared tools, verified facts,
   CEO corrections, important decisions). Not a transcript. Durable.
2. **Department memory** — each department owns separate durable operational
   memory (Marketing: campaigns, audiences, learnings, results; future Sales /
   Finance: their own). Never merged into one global context.
3. **Conversation / thread** — the CEO's current working context. Owns
   conversationId, organizationId, userId, title, timestamps, status
   (active|archived), messages, compacted summary, context references.
4. **Business work** — tasks, approvals, results with their own lifecycle and
   provenance. A conversation may create work; work survives independently of
   the conversation. The conversation can LINK to work, it does not own it.

## Decision

- The central chat remains the single conversational experience, but the
  backend models durable conversation threads each with a `conversationId`.
- Conversations are durable (Survive reload, logout/login, backend restart,
  redeploy) using the existing Supabase/Postgres repository conventions. No
  localStorage, no in-memory Map as production persistence.
- Isolation is mandatory: `conversationId` is scoped to `organizationId`; a
  user from organization A must never access conversations from organization
  B. Tests must cover cross-organization access.
- Context is assembled per message from: current conversation, compacted
  summary if needed, relevant Company DNA, relevant department memory,
  relevant active work, relevant results, relevant connected capabilities.
  Only what is useful is retrieved.
- Conversations compact: recent messages + summary + durable extracted
  knowledge + relevant business state. Important facts graduate from
  conversation into the appropriate durable layer (Company DNA / department
  memory / results) with provenance, confidence, scope and CEO-correction
  precedence. Not every CEO message becomes permanent Company DNA.
- Work retains provenance: where useful, a work item references
  `originConversationId` / `originMessageId`. Results belong to the
  company/work domain and remain available after the conversation is
  archived.
- The unified Inbox (CZ03) can be referenced from conversations (an
  `InboxItem` reference); the current conversation maintains the immediate
  reference but the underlying item persists independently.
- **No new runtime is created.** No ConversationBrain, no ChatMemoryV2, no
  new RAG, no second memory runtime, no ThreadBrain. Reuse the existing
  Company DNA / memory / persistence architecture.

## Consequences

- Implementation is a DEDICATED sprint AFTER Customer Zero 03 founder
  validation. It is NOT implemented inside CZ03.
- During CZ03 persistence work, no new architectural debt may be introduced
  that assumes one organization = one eternal conversation. The current
  `session.state.conversation` is transitional and is explicitly marked as
  such; the dependency must not be deepened.
- The target UX: `+ Nuevo chat` and a recent-conversation sidebar (Today /
  Yesterday / Previous) with business-intent titles the CEO can rename.
- The CEO never sees agent, model, provider, workflow, runtime, MCP or
  specialist concepts.

## Compatibility

- CZ03 ships unchanged. No conversation refactor in CZ03.
- Existing `session.state.conversation` remains for backward compatibility,
  marked transitional.

## Compliance

- ROSA: no new packages. The conversation domain lives in the existing
  Customer Zero / persistence boundaries. Follow-up sprint scopes this as:
  Conversation domain, Message domain, durable repository, organization
  isolation, create/list/open/rename/archive, central chat uses
  conversationId, recent conversation sidebar, context assembler,
  compaction boundary, Company DNA retrieval, department memory retrieval,
  active work retrieval, result references, InboxItem references, work
  provenance, reload/restart persistence, security tests, migration from the
  current single conversation.

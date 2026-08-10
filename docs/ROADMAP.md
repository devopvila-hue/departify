# Roadmap

## Now

- **Customer Zero 03 — Google Workspace + Unified Inbox V1.** Google OAuth
  unified handshake, Gmail + Calendar + Drive capabilities behind one Google
  connection, normalized InboxItem domain + classifier + sync, `/inbox`
  portal route, connection + inbox persistence, security (CSRF / replay /
  org+user binding / no-secret guarantees / prompt-injection boundary).
  Status: implementation complete, awaiting founder human validation.
  See `docs/customer-zero/customer-zero-03-final-report.md`.

## Next

- **P0 — Durable conversations / threads.** The founder decision (ADR 0006):
  the central chat must support multiple durable conversations. The CEO
  creates a new chat, returns to previous chats, renames/archives them, and
  starts a clean conversation WITHOUT losing company knowledge. New chat ≠
  memory reset. Scope: Conversation domain, Message domain, durable
  repository, organization isolation, create/list/open/rename/archive,
  central chat uses conversationId, recent-conversation sidebar, context
  assembler, compaction boundary, Company DNA / department memory / active
  work / result retrieval, InboxItem references, work provenance via
  conversation/message, reload/restart persistence, security tests,
  migration from the current single conversation. No new department
  required. Do NOT start until after CZ03 founder validation.

## Later

- New departments one at a time (Sales, Finance, Operations) using the
  existing Department template pattern.
- Future Microsoft 365 / IMAP inbox channels behind the existing InboxItem
  abstraction.

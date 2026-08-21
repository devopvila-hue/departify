import type { CustomerZeroSession } from "./customer-zero-session.js";
import {
  canonicalSummary,
  COMPACTION_RECENT_VERBATIM,
  DEFAULT_CONVERSATION_TITLE,
  splitForCompaction,
  type ConversationMessage,
  type ConversationRecord,
} from "./conversation-store.js";
import type { PendingWorkType } from "./pending-work-store.js";

export type ConversationCommand = "new" | "compact";

export function isConversationCommandAuthorized(
  command: ConversationCommand,
  role: "owner" | "member" | undefined,
): boolean {
  if (command === "compact") return role === "owner" || role === "member";
  return role === "owner";
}

/** Serializes every stateful turn and lifecycle command for one org session. */
export async function withConversationTurnLock<T>(
  session: CustomerZeroSession,
  action: () => Promise<T>,
): Promise<T> {
  const previous = session.state.turnMutex ?? Promise.resolve();
  let release!: () => void;
  const own = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => own);
  session.state.turnMutex = tail;
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (session.state.turnMutex === tail) delete session.state.turnMutex;
  }
}

export function parseConversationCommand(message: string): ConversationCommand | null {
  const match = /^\s*\/(new|compact)\s*$/i.exec(message);
  return (match?.[1]?.toLowerCase() as ConversationCommand | undefined) ?? null;
}

export interface CompactionResult {
  readonly conversation: ConversationRecord;
  readonly compacted: boolean;
  readonly foldedMessages: number;
  readonly contextBytes: number;
  readonly summaryChars: number;
}

/** The only compaction implementation used by automatic and explicit flows. */
export async function compactConversation(
  session: CustomerZeroSession,
  conversationId: string,
): Promise<CompactionResult> {
  const { organizationId } = session;
  const conversation = await session.conversations.get(organizationId, conversationId);
  if (!conversation || conversation.status !== "active") {
    throw new Error("Active conversation not found.");
  }
  const messages = await session.conversations.listMessages(organizationId, conversationId);
  const { older, recent } = splitForCompaction(messages, COMPACTION_RECENT_VERBATIM);
  const indexById = new Map(messages.map((message, index) => [message.id, index]));
  const priorIndex = conversation.compactedUpToMessageId
    ? (indexById.get(conversation.compactedUpToMessageId) ?? -1)
    : -1;
  const newOlder = older.filter((message) => (indexById.get(message.id) ?? -1) > priorIndex);

  if (newOlder.length === 0) {
    const summaryChars = conversation.summary?.length ?? 0;
    const contextBytes = Buffer.byteLength(conversation.summary ?? "", "utf8")
      + recent.reduce((sum, message) => sum + Buffer.byteLength(message.content, "utf8"), 0);
    return {
      conversation,
      compacted: false,
      foldedMessages: 0,
      contextBytes,
      summaryChars,
    };
  }

  const { summary } = canonicalSummary(
    conversation.summary,
    newOlder.map((message) => ({ role: message.role, content: message.content })),
  );
  const lastFolded = newOlder.at(-1) as ConversationMessage;
  const lastFoldedIndex = indexById.get(lastFolded.id) ?? priorIndex;
  await session.conversations.saveCompaction(
    organizationId,
    conversationId,
    summary,
    lastFolded.id,
    lastFoldedIndex + 1,
  );
  const updated = await session.conversations.get(organizationId, conversationId);
  const contextBytes = Buffer.byteLength(summary, "utf8")
    + recent.reduce((sum, message) => sum + Buffer.byteLength(message.content, "utf8"), 0);
  return {
    conversation: updated ?? conversation,
    compacted: true,
    foldedMessages: newOlder.length,
    contextBytes,
    summaryChars: summary.length,
  };
}

/**
 * Starts a clean working thread while preserving company and department state.
 * Draft approvals belong to the old conversation, so they are terminally
 * cancelled and cannot be resumed accidentally from the new thread.
 */
export async function startNewConversation(
  session: CustomerZeroSession,
): Promise<ConversationRecord> {
  const previousConversationId = session.state.currentConversationId;
  const conversation = await session.conversations.startNew(
    session.organizationId,
    DEFAULT_CONVERSATION_TITLE,
  );
  session.state.currentConversationId = conversation.id;

  if (previousConversationId) {
    const types: readonly PendingWorkType[] = ["email", "calendar", "facebook_pages"];
    // Cleanup is scoped to the archived thread. A provider cleanup failure
    // cannot roll back or hide the already-committed active conversation.
    await Promise.allSettled(types.map((type) =>
      session.pendingWork.completeActive(
        session.organizationId,
        previousConversationId,
        type,
        "cancelled",
        "Conversation reset by user.",
      ),
    ));
  }

  delete session.state.pendingEmailWork;
  delete session.state.pendingCalendarWork;
  delete session.state.pendingFacebookPagesWork;
  delete session.state.lastEmailContext;
  delete session.state.lastCalendarOperation;
  delete session.state.lastExecutionReceipt;
  delete session.state.activeWork;
  session.state.turnSequence = 0;
  session.state.conversation = [];
  return conversation;
}

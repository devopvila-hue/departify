/**
 * Conversation store — Phase P-B (part 15).
 *
 * Durable, organization-scoped CEO chat sessions. Conversations are cleanly
 * separated from company memory: archiving/creating a conversation never
 * touches organizations, DNA, tool state, departments, tasks or approvals.
 *
 * Compaction (part 26): the CEO sees ONE continuous conversation. Internally
 * the conversation carries a deterministic compaction summary that the model
 * receives INSTEAD of the entire historical transcript. Raw messages are
 * preserved in `conversation_messages` for retrieval / search / compliance;
 * compaction NEVER deletes durable history. The model context window is
 * always `[recent verbatim] + [compaction summary] + [active state]`.
 */

export type ConversationRole = "user" | "assistant";

export interface ConversationRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly title: string;
  readonly status: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastMessageAt?: string;
  /** Deterministic summary of older material (preserves durable history
   *  in `conversation_messages`; summary is for context window). */
  readonly summary?: string;
  /** Timestamp of the last compaction. Null until compaction has run. */
  readonly compactedAt?: string;
  /** Latest message id that was folded INTO the summary. */
  readonly compactedUpToMessageId?: string;
  /** Number of source messages folded into the latest summary. */
  readonly compactionMessageCount?: number;
}

export interface ConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: ConversationRole;
  readonly content: string;
  readonly createdAt: string;
}

export interface ConversationMessagePage {
  readonly messages: ConversationMessage[];
  readonly hasMore: boolean;
  /** Cursor for the next older page; opaque to callers. */
  readonly nextCursor?: string;
}

/** Framework-independent persistence port (Supabase in production). */
export interface ConversationStore {
  create(
    organizationId: string,
    title: string,
  ): Promise<ConversationRecord>;
  /** Return the single active CEO thread, creating it atomically when absent. */
  ensureCanonical(
    organizationId: string,
    title?: string,
  ): Promise<ConversationRecord>;
  listForOrg(organizationId: string): Promise<ConversationRecord[]>;
  /** List conversations of any status (default: only `active`).
   *  Archived conversations are recoverable from history without counting
   *  toward the 5-active cap. */
  listForOrgIncludingArchived(
    organizationId: string,
  ): Promise<ConversationRecord[]>;
  countActiveForOrg(organizationId: string): Promise<number>;
  get(organizationId: string, conversationId: string): Promise<ConversationRecord | null>;
  archive(organizationId: string, conversationId: string): Promise<boolean>;
  rename(organizationId: string, conversationId: string, title: string): Promise<boolean>;
  addMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
  ): Promise<ConversationMessage>;
  listMessages(
    organizationId: string,
    conversationId: string,
    limit?: number,
  ): Promise<ConversationMessage[]>;
  listMessagesPage(
    organizationId: string,
    conversationId: string,
    options?: { limit?: number; before?: string },
  ): Promise<ConversationMessagePage>;
  /** Bounded retrieval over raw history; never returns another org's data. */
  searchMessages(
    organizationId: string,
    conversationId: string,
    query: string,
    limit?: number,
  ): Promise<ConversationMessage[]>;
  /** Persist the deterministic compaction summary. Raw messages are kept
   *  in `conversation_messages` untouched. */
  saveCompaction(
    organizationId: string,
    conversationId: string,
    summary: string,
    compactedUpToMessageId: string,
    compactionMessageCount: number,
  ): Promise<boolean>;
}

/** Deterministic, no-LLM title derived from the first user message. */
export function deriveConversationTitle(message: string): string {
  const cleaned = message
    .replace(/^(quiero|necesito|hazme|ay[úu]dame|por favor|me gustar[íi]a|vamos a)\s+/i, "")
    .trim();
  const title = (cleaned.length > 0 ? cleaned : message).slice(0, 48);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export const DEFAULT_CONVERSATION_TITLE = "Nueva conversación";

const BOUNDED_HISTORY_LIMIT = 10;

/** Bounded deterministic context: last N messages, oldest first. */
export function boundedConversationHistory(
  messages: readonly ConversationMessage[],
  limit: number = BOUNDED_HISTORY_LIMIT,
): readonly { role: ConversationRole; content: string }[] {
  return messages.slice(-limit).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

/* -------------------------------------------------------------------------
 * Compaction — hierarchical context assembly.
 *
 * The brief forbids hardcoded token numbers without inspecting the existing
 * context-budget abstraction. Departify uses a deterministic character-budget
 * threshold so the rule is provider-independent. When the total transcript
 * exceeds `COMPACTION_THRESHOLD_CHARS` characters the OLDER half is folded
 * into a deterministic summary (no LLM call, per the brief). The summary is
 * persisted on the conversation row alongside `compactedUpToMessageId` so
 * the model can pick up where it left off.
 *
 * Context assembly for the LLM is therefore always:
 *
 *   [conversation.summary if present]
 *   + [recent verbatim messages, bounded to BOUNDED_HISTORY_LIMIT]
 *
 * Raw historical messages stay in `conversation_messages` (durable,
 * recoverable, full-fidelity) and are NEVER deleted by compaction.
 * -----------------------------------------------------------------------*/

export const COMPACTION_THRESHOLD_CHARS = 8_000;
/** Recent messages kept verbatim, alongside the summary, in the model
 *  context. Older ones live in `conversation_messages` only. */
export const COMPACTION_RECENT_VERBATIM = BOUNDED_HISTORY_LIMIT;

/** True when the transcript is large enough to compact. */
export function shouldCompact(totalChars: number): boolean {
  return totalChars > COMPACTION_THRESHOLD_CHARS;
}

/** Deterministic compaction summary.
 *
 *  The summary preserves: count, first/last user message, recent topics,
 *  facts/decisions/proposals captured in older turns. It avoids leaking
 *  unstructured data into the model context — older raw messages are
 *  reachable by retrieval, the model only consumes the summary. */
export function summarizeOldMessages(
  olderMessages: readonly { role: ConversationRole; content: string }[],
): string {
  if (olderMessages.length === 0) return "";

  const userCount = olderMessages.filter((m) => m.role === "user").length;
  const assistantCount = olderMessages.length - userCount;
  const firstUser = olderMessages.find((m) => m.role === "user");
  const lastUser = [...olderMessages].reverse().find((m) => m.role === "user");

  const facts: string[] = [];
  for (const m of olderMessages) {
    const lowered = m.content.toLowerCase();
    // Capture durable business rules / decisions. A real LLM pass would
    // upgrade this; this deterministic pass keeps the contract honest.
    if (
      /\b(nunca|no\s+\w+|siempre|jamas|regla|no\s+olvides|recuerda)\b/.test(
        lowered,
      )
    ) {
      const line = m.content.replace(/\s+/g, " ").trim();
      if (line.length > 0) facts.push(line.slice(0, 160));
    }
  }

  const lines: string[] = [];
  lines.push(`Resumen de la conversación (compactado).`);
  lines.push(`Turnos anteriores: ${userCount} del CEO y ${assistantCount} de la empresa.`);
  if (firstUser) {
    lines.push(`Primer tema del CEO: ${firstUser.content.slice(0, 160)}`);
  }
  if (lastUser && lastUser !== firstUser) {
    lines.push(`Último tema del CEO en este tramo: ${lastUser.content.slice(0, 160)}`);
  }
  if (facts.length > 0) {
    lines.push(`Hechos mencionados:`);
    for (const fact of facts.slice(0, 5)) lines.push(`- ${fact}`);
  }

  return lines.join("\n");
}

/** Split the message log into the older half (to summarize) and the recent
 *  half (kept verbatim). */
export function splitForCompaction(
  messages: readonly ConversationMessage[],
  keepRecent: number = COMPACTION_RECENT_VERBATIM,
): {
  older: ConversationMessage[];
  recent: ConversationMessage[];
} {
  if (messages.length <= keepRecent) {
    return { older: [], recent: [...messages] };
  }
  return {
    older: messages.slice(0, messages.length - keepRecent),
    recent: messages.slice(messages.length - keepRecent),
  };
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, ConversationMessage[]>();
  private counter = 0;

  async create(
    organizationId: string,
    title: string,
  ): Promise<ConversationRecord> {
    this.counter += 1;
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      id: `conversation_${this.counter}`,
      organizationId,
      title,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(record.id, record);
    this.messages.set(record.id, []);
    return record;
  }

  async ensureCanonical(
    organizationId: string,
    title = DEFAULT_CONVERSATION_TITLE,
  ): Promise<ConversationRecord> {
    const active = await this.listForOrg(organizationId);
    if (active[0]) return active[0];
    return this.create(organizationId, title);
  }

  async listForOrg(organizationId: string): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter(
        (conversation) =>
          conversation.organizationId === organizationId &&
          conversation.status === "active",
      )
      .sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
      );
  }

  async listForOrgIncludingArchived(
    organizationId: string,
  ): Promise<ConversationRecord[]> {
    return [...this.conversations.values()]
      .filter((conversation) => conversation.organizationId === organizationId)
      .sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
      );
  }

  async countActiveForOrg(organizationId: string): Promise<number> {
    let count = 0;
    for (const c of this.conversations.values()) {
      if (c.organizationId === organizationId && c.status === "active") count++;
    }
    return count;
  }

  async get(
    organizationId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const record = this.conversations.get(conversationId) ?? null;
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async archive(
    organizationId: string,
    conversationId: string,
  ): Promise<boolean> {
    const record = await this.get(organizationId, conversationId);
    if (!record) return false;
    this.conversations.set(conversationId, {
      ...record,
      status: "archived",
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  async rename(
    organizationId: string,
    conversationId: string,
    title: string,
  ): Promise<boolean> {
    const record = await this.get(organizationId, conversationId);
    if (!record) return false;
    this.conversations.set(conversationId, {
      ...record,
      title,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }

  async addMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
  ): Promise<ConversationMessage> {
    const record = this.conversations.get(conversationId);
    if (!record) {
      throw new Error("Conversation not found.");
    }
    const now = new Date().toISOString();
    const message: ConversationMessage = {
      id: `msg_${this.counter}_${(this.messages.get(conversationId)?.length ?? 0)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      conversationId,
      role,
      content,
      createdAt: now,
    };
    this.messages.set(conversationId, [
      ...(this.messages.get(conversationId) ?? []),
      message,
    ]);
    this.conversations.set(conversationId, {
      ...record,
      lastMessageAt: now,
      updatedAt: now,
    });
    return message;
  }

  async listMessages(
    organizationId: string,
    conversationId: string,
    limit?: number,
  ): Promise<ConversationMessage[]> {
    const record = await this.get(organizationId, conversationId);
    if (!record) return [];
    const all = this.messages.get(conversationId) ?? [];
    return limit ? all.slice(-limit) : all;
  }

  async listMessagesPage(
    organizationId: string,
    conversationId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<ConversationMessagePage> {
    const record = await this.get(organizationId, conversationId);
    if (!record) return { messages: [], hasMore: false };
    const limit = Math.max(1, Math.min(options.limit ?? 40, 1000));
    const all = (this.messages.get(conversationId) ?? []).filter((message) =>
      options.before ? message.createdAt < options.before : true,
    );
    const page = all.slice(-limit);
    const hasMore = all.length > page.length;
    return {
      messages: page,
      hasMore,
      ...(hasMore && page[0] ? { nextCursor: page[0].createdAt } : {}),
    };
  }

  async searchMessages(
    organizationId: string,
    conversationId: string,
    query: string,
    limit = 8,
  ): Promise<ConversationMessage[]> {
    const record = await this.get(organizationId, conversationId);
    if (!record) return [];
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 4).slice(0, 4);
    if (terms.length === 0) return [];
    return (this.messages.get(conversationId) ?? [])
      .filter((message) => terms.some((term) => message.content.toLowerCase().includes(term)))
      .slice(-Math.max(1, Math.min(limit, 20)));
  }

  async saveCompaction(
    organizationId: string,
    conversationId: string,
    summary: string,
    compactedUpToMessageId: string,
    compactionMessageCount: number,
  ): Promise<boolean> {
    const record = await this.get(organizationId, conversationId);
    if (!record) return false;
    this.conversations.set(conversationId, {
      ...record,
      summary,
      compactedAt: new Date().toISOString(),
      compactedUpToMessageId,
      compactionMessageCount,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}

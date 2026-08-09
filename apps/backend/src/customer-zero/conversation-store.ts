/**
 * Conversation store — Phase P-B (part 15).
 *
 * Durable, organization-scoped CEO chat sessions. Conversations are cleanly
 * separated from company memory: archiving/creating a conversation never
 * touches organizations, DNA, tool state, departments, tasks or approvals.
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
}

export interface ConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly role: ConversationRole;
  readonly content: string;
  readonly createdAt: string;
}

/** Framework-independent persistence port (Supabase in production). */
export interface ConversationStore {
  create(
    organizationId: string,
    title: string,
  ): Promise<ConversationRecord>;
  listForOrg(organizationId: string): Promise<ConversationRecord[]>;
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
      id: `msg_${this.counter}_${this.messages.get(conversationId)?.length ?? 0}`,
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
}

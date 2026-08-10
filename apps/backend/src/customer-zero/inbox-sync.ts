/**
 * InboxSync — Customer Zero 03.
 *
 * Pulls recent messages from Gmail and normalizes them into the
 * Unified Inbox domain. The sync:
 *   1. Looks up the Gmail token for the (organizationId, userId).
 *   2. Calls GmailAdapter.searchMessages with a recent window.
 *   3. Normalizes each EmailMessage → InboxItem.
 *   4. Runs classifyInboxItem (deterministic, no LLM).
 *   5. Persists via InboxStore.upsert (deduplicates by
 *      (organizationId, source, sourceMessageId)).
 *
 * The sync is intentionally minimal — V1 is "recent + relevant
 * business email" not "complete mailbox". The brief forbids a
 * full email client.
 */

import { GmailAdapter } from "./gmail-adapter.js";
import {
  buildPreview,
  classifyInboxItem,
  InMemoryInboxStore,
  type InboxItem,
  type InboxStore,
} from "./inbox-domain.js";

export interface InboxSyncInput {
  readonly organizationId: string;
  readonly userId: string;
  /** ISO timestamp; only messages newer than this are imported. */
  readonly sinceIso?: string;
  readonly maxResults?: number;
}

export interface InboxSyncResult {
  readonly imported: number;
  readonly classified: number;
  readonly highImportance: number;
}

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export class InboxSync {
  constructor(
    private readonly store: InboxStore = new InMemoryInboxStore(),
  ) {}

  async run(input: InboxSyncInput): Promise<InboxSyncResult> {
    const sinceIso =
      input.sinceIso ??
      new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();
    const maxResults = input.maxResults ?? 25;
    const adapter = new GmailAdapter(
      { organizationId: input.organizationId, userId: input.userId },
      process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "test-client-id",
      process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "test-client-secret",
    );
    const search = await adapter.searchMessages(`after:${sinceIso}`, maxResults);
    if (!search.success || !search.value) {
      return { imported: 0, classified: 0, highImportance: 0 };
    }

    let imported = 0;
    let classified = 0;
    let highImportance = 0;
    for (const message of search.value) {
      const item = await this.normalizeAndPersist(
        input.organizationId,
        message,
      );
      if (item) {
        imported += 1;
        classified += 1;
        if (item.importance >= 0.7) highImportance += 1;
      }
    }
    return { imported, classified, highImportance };
  }

  private async normalizeAndPersist(
    organizationId: string,
    message: import("./gmail-adapter.js").EmailMessage,
  ): Promise<InboxItem | null> {
    const classification = classifyInboxItem({
      subject: message.subject,
      plainText: message.snippet,
      fromEmail: message.from.email,
      toEmails: message.to.map((a) => a.email),
    });
    const item = await this.store.upsert({
      organizationId,
      source: "gmail",
      sourceMessageId: message.id,
      sourceThreadId: message.threadId,
      channel: "email",
      category: classification.category,
      subject: message.subject || "(Sin asunto)",
      sender: {
        email: message.from.email,
        ...(message.from.displayName ? { displayName: message.from.displayName } : {}),
      },
      recipients: message.to.map((a) => ({
        email: a.email,
        ...(a.displayName ? { displayName: a.displayName } : {}),
      })),
      plainText: message.snippet || "",
      preview: buildPreview(message.snippet || message.subject),
      receivedAt: message.date || new Date().toISOString(),
      unread: message.isUnread,
      importance: classification.importance,
      departmentId: classification.departmentId,
      isLead: classification.isLead,
      relatedWorkItemId: null,
      relatedConversationId: null,
      provenance: { provider: "gmail", rawEventId: message.id },
      state: "classified",
    });
    return item;
  }
}

/**
 * InboxSync — Customer Zero 03.
 *
 * Pulls recent messages from the selected email provider and normalizes them into the
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

import { GmailAdapter, gmailTokenStore } from "./gmail-adapter.js";
import { HostingerEmailAdapter, probeHostingerEmail, type NormalizedEmailMessage } from "./hostinger-email-adapter.js";
import { hasOperationalGoogleCapabilityForOrg } from "./credential-resolver.js";
import { getCorporateEmailStore } from "./corporate-email-store.js";
import { readCorporateInbox, type CorporateEmailMessage } from "./corporate-email-adapter.js";
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
    // Each provider is resolved independently. A provider outage must not
    // hide successful messages from another connected provider.
    const providerReads = await Promise.allSettled([
      this.readHostinger(maxResults),
      this.readGmailIfOperational(input, sinceIso, maxResults),
      this.readCorporateIfOperational(input, maxResults),
    ]);
    const messages: readonly {
      readonly provider: "gmail" | "hostinger" | "corporate";
      readonly message: import("./gmail-adapter.js").EmailMessage | NormalizedEmailMessage | CorporateEmailMessage;
    }[] = providerReads.flatMap((result, index) => {
      const provider = index === 0 ? "hostinger" : index === 1 ? "gmail" : "corporate";
      if (result.status === "fulfilled") {
        return result.value.map((message) => ({ provider, message }));
      }
      console.warn(`[inbox-sync] ${JSON.stringify({
        event: "provider_sync_failed",
        provider,
        category: result.reason instanceof Error && "category" in result.reason
          ? String((result.reason as { category?: unknown }).category ?? "provider_error")
          : "provider_error",
      })}`);
      return [];
    });

    let imported = 0;
    let classified = 0;
    let highImportance = 0;
    for (const entry of messages) {
      const item = await this.normalizeAndPersist(
        input.organizationId,
        entry.message,
        entry.provider,
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
    message: import("./gmail-adapter.js").EmailMessage | NormalizedEmailMessage | CorporateEmailMessage,
    source: "gmail" | "hostinger" | "corporate",
  ): Promise<InboxItem | null> {
    const gmailMessage = source === "gmail"
      ? message as import("./gmail-adapter.js").EmailMessage
      : null;
    const hostingerMessage = source === "hostinger"
      ? message as NormalizedEmailMessage
      : null;
    const corporateMessage = source === "corporate"
      ? message as CorporateEmailMessage
      : null;
    const sourceMessageId = gmailMessage?.id ?? hostingerMessage?.providerMessageId ?? "";
    const resolvedSourceMessageId = source === "corporate"
      ? corporateMessage?.id ?? ""
      : sourceMessageId;
    const sourceThreadId = gmailMessage?.threadId ?? hostingerMessage?.providerThreadId ?? corporateMessage?.threadId;
    const receivedAt = gmailMessage?.date ?? hostingerMessage?.receivedAt ?? corporateMessage?.date ?? "";
    const hostingerText = hostingerMessage?.textBody ?? "";
    const snippet = hostingerText || (
      gmailMessage?.snippet ?? hostingerMessage?.preview ?? corporateMessage?.snippet ?? ""
    );
    const unread = gmailMessage?.isUnread ?? hostingerMessage?.unread ?? corporateMessage?.isUnread ?? false;
    const recipients: readonly { email: string; displayName?: string }[] = source === "corporate"
      ? []
      : (message as import("./gmail-adapter.js").EmailMessage | NormalizedEmailMessage).to.map((a) => ({
        email: a.email,
        ...(a.displayName ? { displayName: a.displayName } : {}),
      }));
    const cc = source === "hostinger"
      ? (hostingerMessage?.cc ?? []).map((a) => ({ email: a.email, ...(a.displayName ? { displayName: a.displayName } : {}) }))
      : [];
    const classification = classifyInboxItem({
      subject: message.subject,
      plainText: snippet,
      fromEmail: message.from.email,
      toEmails: recipients.map((a) => a.email),
    });
    const item = await this.store.upsert({
      organizationId,
      source,
      sourceMessageId: resolvedSourceMessageId,
      ...(sourceThreadId ? { sourceThreadId } : {}),
      channel: "email",
      category: classification.category,
      subject: message.subject || "(Sin asunto)",
      sender: {
        email: message.from.email,
        ...(message.from.displayName ? { displayName: message.from.displayName } : {}),
      },
      recipients,
      cc,
      plainText: snippet || "",
      ...(hostingerMessage?.htmlBody ? { htmlBody: hostingerMessage.htmlBody } : {}),
      preview: buildPreview(snippet || message.subject),
      attachments: source === "hostinger" ? (hostingerMessage?.attachments ?? []) : [],
      ...(hostingerMessage?.mailbox ? { mailbox: hostingerMessage.mailbox } : {}),
      ...(hostingerMessage?.folder ? { folder: hostingerMessage.folder } : {}),
      receivedAt: receivedAt || new Date().toISOString(),
      unread,
      importance: classification.importance,
      departmentId: classification.departmentId,
      isLead: classification.isLead,
      relatedWorkItemId: null,
      relatedConversationId: null,
      provenance: {
        provider: source,
        rawEventId: resolvedSourceMessageId,
        ...(hostingerMessage?.providerMessageUid
          ? { providerMessageUid: hostingerMessage.providerMessageUid }
          : {}),
      },
      state: "classified",
    });
    return item;
  }

  private async readGmail(
    input: InboxSyncInput,
    sinceIso: string,
    maxResults: number,
  ): Promise<readonly import("./gmail-adapter.js").EmailMessage[]> {
    const adapter = new GmailAdapter(
      { organizationId: input.organizationId, userId: input.userId },
      process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "test-client-id",
      process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "test-client-secret",
    );
    const search = await adapter.searchMessages(`after:${sinceIso}`, maxResults);
    return search.success && search.value ? search.value : [];
  }

  private async readGmailIfOperational(
    input: InboxSyncInput,
    sinceIso: string,
    maxResults: number,
  ): Promise<readonly import("./gmail-adapter.js").EmailMessage[]> {
    const durableOperational = await hasOperationalGoogleCapabilityForOrg(
      input.organizationId,
      "email.read",
    );
    const legacyOperational = Boolean(gmailTokenStore.get(input.organizationId, input.userId));
    if (!durableOperational && !legacyOperational) return [];
    return this.readGmail(input, sinceIso, maxResults);
  }

  private async readHostinger(
    maxResults: number,
  ): Promise<readonly NormalizedEmailMessage[]> {
    const status = await probeHostingerEmail();
    if (status.state !== "connected" || !status.capabilities.includes("email.read")) return [];
    return new HostingerEmailAdapter().readRecentMessages(maxResults);
  }

  private async readCorporateIfOperational(
    input: InboxSyncInput,
    maxResults: number,
  ): Promise<readonly CorporateEmailMessage[]> {
    const store = getCorporateEmailStore();
    const summaries = await store.listForOrg(input.organizationId);
    const messages: CorporateEmailMessage[] = [];
    for (const summary of summaries) {
      if (!summary.operationalVerifiedAt) continue;
      const account = await store.get(input.organizationId, summary.userId);
      if (!account) continue;
      messages.push(...await readCorporateInbox(account, maxResults));
      if (messages.length >= maxResults) break;
    }
    return messages.slice(0, maxResults);
  }
}

/**
 * Supabase inbox store — Customer Zero 03.
 *
 * Durable, organization-scoped Unified Inbox backed by the `inbox_items`
 * table. Service role only (backend); RLS remains defense-in-depth for direct
 * reads. Provider payloads and any secrets are never stored here — only the
 * normalized InboxItem business shape.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type {
  InboxCategory,
  InboxItem,
  InboxItemState,
  InboxStore,
} from "./inbox-domain.js";
import type { InboxClassification } from "./inbox-domain.js";

interface InboxItemRow {
  id: string;
  organization_id: string;
  source: string;
  source_message_id: string;
  source_thread_id: string | null;
  channel: string;
  category: string;
  subject: string;
  sender_email: string;
  sender_name: string | null;
  recipients: { email: string; displayName?: string }[];
  cc: { email: string; displayName?: string }[];
  plain_text: string;
  html_body: string | null;
  preview: string;
  attachments: { filename?: string; mimeType?: string; size?: number }[];
  mailbox: string | null;
  folder: string | null;
  received_at: string;
  unread: boolean;
  importance: number;
  department_id: string | null;
  is_lead: boolean;
  related_work_item_id: string | null;
  related_conversation_id: string | null;
  provenance: { provider: string; rawEventId?: string };
  state: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: InboxItemRow): InboxItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    source: row.source,
    sourceMessageId: row.source_message_id,
    ...(row.source_thread_id ? { sourceThreadId: row.source_thread_id } : {}),
    channel: row.channel as InboxItem["channel"],
    category: row.category as InboxCategory,
    subject: row.subject,
    sender: {
      email: row.sender_email,
      ...(row.sender_name ? { displayName: row.sender_name } : {}),
    },
    recipients: row.recipients ?? [],
    cc: row.cc ?? [],
    plainText: row.plain_text,
    ...(row.html_body ? { htmlBody: row.html_body } : {}),
    preview: row.preview,
    attachments: row.attachments ?? [],
    ...(row.mailbox ? { mailbox: row.mailbox } : {}),
    ...(row.folder ? { folder: row.folder } : {}),
    receivedAt: row.received_at,
    unread: row.unread,
    importance: Number(row.importance),
    departmentId: row.department_id,
    isLead: row.is_lead,
    relatedWorkItemId: row.related_work_item_id,
    relatedConversationId: row.related_conversation_id,
    provenance: row.provenance ?? { provider: row.source },
    state: row.state as InboxItemState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseInboxStore implements InboxStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async upsert(
    item: Omit<InboxItem, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<InboxItem> {
    const { data, error } = await this.admin
      .from("inbox_items")
      .upsert(
        {
          organization_id: item.organizationId,
          source: item.source,
          source_message_id: item.sourceMessageId,
          ...(item.sourceThreadId ? { source_thread_id: item.sourceThreadId } : {}),
          channel: item.channel,
          category: item.category,
          subject: item.subject,
          sender_email: item.sender.email,
          ...(item.sender.displayName ? { sender_name: item.sender.displayName } : {}),
          recipients: JSON.stringify(item.recipients),
          cc: JSON.stringify(item.cc ?? []),
          plain_text: item.plainText,
          html_body: item.htmlBody ?? null,
          preview: item.preview,
          attachments: JSON.stringify(item.attachments ?? []),
          mailbox: item.mailbox ?? null,
          folder: item.folder ?? null,
          received_at: item.receivedAt,
          unread: item.unread,
          importance: item.importance,
          department_id: item.departmentId,
          is_lead: item.isLead,
          related_work_item_id: item.relatedWorkItemId,
          related_conversation_id: item.relatedConversationId,
          provenance: item.provenance,
          state: item.state,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,source,source_message_id" },
      )
      .select("*")
      .maybeSingle();
    if (error) throw error;
    return mapRow((data as unknown as InboxItemRow)!);
  }

  async get(id: string): Promise<InboxItem | null> {
    const { data, error } = await this.admin
      .from("inbox_items")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapRow(data as unknown as InboxItemRow);
  }

  async list(input: {
    organizationId: string;
    category?: InboxCategory;
    state?: InboxItemState;
    limit?: number;
  }): Promise<InboxItem[]> {
    let query = this.admin
      .from("inbox_items")
      .select("*")
      .eq("organization_id", input.organizationId)
      .order("received_at", { ascending: false })
      .limit(input.limit ?? 50);
    if (input.category) query = query.eq("category", input.category);
    if (input.state) query = query.eq("state", input.state);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as unknown as InboxItemRow));
  }

  async setState(id: string, state: InboxItemState): Promise<InboxItem> {
    const { data, error } = await this.admin
      .from("inbox_items")
      .update({ state, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`InboxItem ${id} not found`);
    return mapRow(data as unknown as InboxItemRow);
  }

  async setClassification(
    id: string,
    classification: InboxClassification,
  ): Promise<InboxItem> {
    const { data, error } = await this.admin
      .from("inbox_items")
      .update({
        category: classification.category,
        importance: classification.importance,
        is_lead: classification.isLead,
        department_id: classification.departmentId,
        state: "classified",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`InboxItem ${id} not found`);
    return mapRow(data as unknown as InboxItemRow);
  }

  async setRelatedWorkItem(
    id: string,
    workItemId: string | null,
  ): Promise<InboxItem> {
    const { data, error } = await this.admin
      .from("inbox_items")
      .update({
        related_work_item_id: workItemId,
        state: workItemId ? "in_work" : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`InboxItem ${id} not found`);
    return mapRow(data as unknown as InboxItemRow);
  }
}

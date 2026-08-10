/**
 * Supabase conversation store — Phase P-B (part 15 + 26).
 *
 * Durable conversations + messages backed by Supabase (service role; RLS is
 * defense-in-depth). Organization-scoped by construction — every lookup is
 * constrained to the organization id. Compaction summary lives on the
 * conversation row (see migration 20260810140000_conversations_compaction.sql).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type {
  ConversationMessage,
  ConversationRecord,
  ConversationRole,
  ConversationStore,
} from "./conversation-store.js";

interface ConversationRow {
  id: string;
  organization_id: string;
  title: string;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  summary: string | null;
  compacted_at: string | null;
  compacted_up_to_message_id: string | null;
  compaction_message_count: number | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: ConversationRole;
  content: string;
  created_at: string;
}

export class SupabaseConversationStore implements ConversationStore {
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

  async create(
    organizationId: string,
    title: string,
  ): Promise<ConversationRecord> {
    const { data, error } = await this.admin
      .from("conversations")
      .insert({ organization_id: organizationId, title, status: "active" })
      .select()
      .single();
    if (error) throw error;
    return mapConversation(data as ConversationRow);
  }

  async listForOrg(organizationId: string): Promise<ConversationRecord[]> {
    const { data, error } = await this.admin
      .from("conversations")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapConversation(row as ConversationRow));
  }

  async listForOrgIncludingArchived(
    organizationId: string,
  ): Promise<ConversationRecord[]> {
    const { data, error } = await this.admin
      .from("conversations")
      .select("*")
      .eq("organization_id", organizationId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data ?? []).map((row) => mapConversation(row as ConversationRow));
  }

  async countActiveForOrg(organizationId: string): Promise<number> {
    const { count, error } = await this.admin
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "active");
    if (error) throw error;
    return count ?? 0;
  }

  async get(
    organizationId: string,
    conversationId: string,
  ): Promise<ConversationRecord | null> {
    const { data, error } = await this.admin
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapConversation(data as ConversationRow);
  }

  async archive(
    organizationId: string,
    conversationId: string,
  ): Promise<boolean> {
    const { data, error } = await this.admin
      .from("conversations")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async rename(
    organizationId: string,
    conversationId: string,
    title: string,
  ): Promise<boolean> {
    const { data, error } = await this.admin
      .from("conversations")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async addMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
  ): Promise<ConversationMessage> {
    const { data, error } = await this.admin
      .from("conversation_messages")
      .insert({ conversation_id: conversationId, role, content })
      .select()
      .single();
    if (error) throw error;
    const message = mapMessage(data as MessageRow);
    await this.admin
      .from("conversations")
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
    return message;
  }

  async listMessages(
    organizationId: string,
    conversationId: string,
    limit?: number,
  ): Promise<ConversationMessage[]> {
    const record = await this.get(organizationId, conversationId);
    if (!record) return [];
    let query = this.admin
      .from("conversation_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (limit) {
      query = query.limit(limit);
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => mapMessage(row as MessageRow));
  }

  async saveCompaction(
    organizationId: string,
    conversationId: string,
    summary: string,
    compactedUpToMessageId: string,
    compactionMessageCount: number,
  ): Promise<boolean> {
    const { data, error } = await this.admin
      .from("conversations")
      .update({
        summary,
        compacted_at: new Date().toISOString(),
        compacted_up_to_message_id: compactedUpToMessageId,
        compaction_message_count: compactionMessageCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .select("id");
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_message_at ? { lastMessageAt: row.last_message_at } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.compacted_at ? { compactedAt: row.compacted_at } : {}),
    ...(row.compacted_up_to_message_id
      ? { compactedUpToMessageId: row.compacted_up_to_message_id }
      : {}),
    ...(typeof row.compaction_message_count === "number"
      ? { compactionMessageCount: row.compaction_message_count }
      : {}),
  };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

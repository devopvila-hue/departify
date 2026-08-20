/**
 * Durable pending conversational work.
 *
 * This deliberately stores only the safe, resumable business payload for
 * approval-gated actions. Credentials remain in their existing vaults and
 * adapters. Records are always addressed by organization + conversation.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

export type PendingWorkType = "email" | "calendar" | "facebook_pages";
export type DurablePendingWorkStatus = "active" | "executing" | "failed" | "succeeded" | "cancelled" | "ambiguous";

export interface DurablePendingWork {
  readonly operationId: string;
  readonly organizationId: string;
  readonly conversationId: string;
  readonly userId: string | null;
  readonly type: PendingWorkType;
  readonly status: DurablePendingWorkStatus;
  /** Safe draft/proposal data only — never tokens or connector credentials. */
  readonly payload: Record<string, unknown>;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PendingWorkStore {
  upsert(work: DurablePendingWork): Promise<void>;
  getActive(organizationId: string, conversationId: string, type: PendingWorkType): Promise<DurablePendingWork | null>;
  completeActive(
    organizationId: string,
    conversationId: string,
    type: PendingWorkType,
    status: Extract<DurablePendingWorkStatus, "succeeded" | "cancelled" | "failed" | "ambiguous">,
    lastError?: string | null,
  ): Promise<void>;
}

function key(organizationId: string, conversationId: string, type: PendingWorkType): string {
  return `${organizationId}:${conversationId}:${type}`;
}

export class InMemoryPendingWorkStore implements PendingWorkStore {
  private readonly records = new Map<string, DurablePendingWork>();

  async upsert(work: DurablePendingWork): Promise<void> {
    this.records.set(key(work.organizationId, work.conversationId, work.type), { ...work });
  }

  async getActive(organizationId: string, conversationId: string, type: PendingWorkType): Promise<DurablePendingWork | null> {
    const work = this.records.get(key(organizationId, conversationId, type));
    return work && (work.status === "active" || work.status === "executing" || work.status === "failed" || work.status === "ambiguous")
      ? { ...work, payload: { ...work.payload } }
      : null;
  }

  async completeActive(
    organizationId: string,
    conversationId: string,
    type: PendingWorkType,
    status: Extract<DurablePendingWorkStatus, "succeeded" | "cancelled" | "failed" | "ambiguous">,
    lastError: string | null = null,
  ): Promise<void> {
    const existing = this.records.get(key(organizationId, conversationId, type));
    if (!existing) return;
    this.records.set(key(organizationId, conversationId, type), {
      ...existing,
      status,
      lastError,
      updatedAt: new Date().toISOString(),
    });
  }
}

interface PendingWorkRow {
  operation_id: string;
  organization_id: string;
  conversation_id: string;
  user_id: string | null;
  type: PendingWorkType;
  status: DurablePendingWorkStatus;
  payload: Record<string, unknown>;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: PendingWorkRow): DurablePendingWork {
  return {
    operationId: row.operation_id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    type: row.type,
    status: row.status,
    payload: row.payload ?? {},
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabasePendingWorkStore implements PendingWorkStore {
  private readonly admin: SupabaseClient;
  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async upsert(work: DurablePendingWork): Promise<void> {
    const { error } = await this.admin.from("conversation_pending_work").upsert({
      operation_id: work.operationId,
      organization_id: work.organizationId,
      conversation_id: work.conversationId,
      user_id: work.userId,
      type: work.type,
      status: work.status,
      payload: work.payload,
      last_error: work.lastError,
      created_at: work.createdAt,
      updated_at: work.updatedAt,
    }, { onConflict: "organization_id,conversation_id,type" });
    if (error) throw error;
  }

  async getActive(organizationId: string, conversationId: string, type: PendingWorkType): Promise<DurablePendingWork | null> {
    const { data, error } = await this.admin.from("conversation_pending_work").select("*")
      .eq("organization_id", organizationId).eq("conversation_id", conversationId).eq("type", type)
      .in("status", ["active", "executing", "failed", "ambiguous"]).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as PendingWorkRow) : null;
  }

  async completeActive(
    organizationId: string,
    conversationId: string,
    type: PendingWorkType,
    status: Extract<DurablePendingWorkStatus, "succeeded" | "cancelled" | "failed" | "ambiguous">,
    lastError: string | null = null,
  ): Promise<void> {
    const { error } = await this.admin.from("conversation_pending_work").update({
      status,
      last_error: lastError,
      updated_at: new Date().toISOString(),
    }).eq("organization_id", organizationId).eq("conversation_id", conversationId).eq("type", type)
      .in("status", ["active", "executing", "failed", "ambiguous"]);
    if (error) throw error;
  }
}

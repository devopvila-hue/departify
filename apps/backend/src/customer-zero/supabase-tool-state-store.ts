/**
 * Supabase tool state store — Phase P-B.
 *
 * Durable, organization-scoped tool/connection lifecycle backed by the
 * `organization_tool_states` table. Service role only (backend); RLS remains
 * defense-in-depth for direct reads. Credential values never touch these rows.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type {
  OrganizationToolState,
  ToolHealth,
  ToolLifecycleStatus,
  ToolStateStore,
} from "./tool-state.js";

interface ToolStateRow {
  organization_id: string;
  tool_id: string;
  status: ToolLifecycleStatus;
  declared: boolean;
  label: string;
  capability: string | null;
  config_source: string | null;
  verified_at: string | null;
  health: ToolHealth | null;
  updated_at: string;
}

export class SupabaseToolStateStore implements ToolStateStore {
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

  async get(
    organizationId: string,
    toolId: string,
  ): Promise<OrganizationToolState | null> {
    const { data, error } = await this.admin
      .from("organization_tool_states")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("tool_id", toolId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return mapRow(data as ToolStateRow);
  }

  async listForOrg(organizationId: string): Promise<OrganizationToolState[]> {
    const { data, error } = await this.admin
      .from("organization_tool_states")
      .select("*")
      .eq("organization_id", organizationId);
    if (error) throw error;
    return (data ?? []).map((row) => mapRow(row as ToolStateRow));
  }

  async upsert(state: OrganizationToolState): Promise<void> {
    const { error } = await this.admin.from("organization_tool_states").upsert(
      {
        organization_id: state.organizationId,
        tool_id: state.toolId,
        status: state.status,
        declared: state.declared,
        label: state.label,
        ...(state.capability ? { capability: state.capability } : {}),
        ...(state.configSource ? { config_source: state.configSource } : {}),
        ...(state.verifiedAt ? { verified_at: state.verifiedAt } : {}),
        ...(state.health ? { health: state.health } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,tool_id" },
    );
    if (error) throw error;
  }
}

function mapRow(row: ToolStateRow): OrganizationToolState {
  return {
    organizationId: row.organization_id,
    toolId: row.tool_id,
    label: row.label,
    ...(row.capability ? { capability: row.capability } : {}),
    declared: row.declared,
    status: row.status,
    ...(row.config_source ? { configSource: row.config_source } : {}),
    ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
    ...(row.health ? { health: row.health } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

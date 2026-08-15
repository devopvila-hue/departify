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
  connection_provider: string | null;
  provider_account_ref: string | null;
  granted_capabilities: string[] | null;
  granted_scopes: string[] | null;
  verified_at: string | null;
  last_validated_at: string | null;
  health: ToolHealth | null;
  last_error: string | null;
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
        ...(state.provider ? { connection_provider: state.provider } : {}),
        ...(state.providerAccountRef ? { provider_account_ref: state.providerAccountRef } : {}),
        ...(state.grantedCapabilities ? { granted_capabilities: [...state.grantedCapabilities] } : {}),
        ...(state.grantedScopes ? { granted_scopes: [...state.grantedScopes] } : {}),
        ...(state.verifiedAt ? { verified_at: state.verifiedAt } : {}),
        ...(state.lastValidatedAt ? { last_validated_at: state.lastValidatedAt } : {}),
        ...(state.health ? { health: state.health } : {}),
        ...(state.lastError ? { last_error: state.lastError } : {}),
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
    ...(row.connection_provider ? { provider: row.connection_provider } : {}),
    ...(row.provider_account_ref ? { providerAccountRef: row.provider_account_ref } : {}),
    ...(row.granted_capabilities ? { grantedCapabilities: row.granted_capabilities } : {}),
    ...(row.granted_scopes ? { grantedScopes: row.granted_scopes } : {}),
    ...(row.verified_at ? { verifiedAt: row.verified_at } : {}),
    ...(row.last_validated_at ? { lastValidatedAt: row.last_validated_at } : {}),
    ...(row.health ? { health: row.health } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  };
}

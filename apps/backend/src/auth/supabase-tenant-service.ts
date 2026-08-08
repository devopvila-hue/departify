/**
 * Supabase tenant service — Phase P0-A.
 *
 * The production implementation of the auth boundary:
 *
 *   - Identity: `supabase.auth.getUser(token)` validates the Bearer token
 *     against the Supabase Auth server (never trusts JWT claims blindly).
 *   - Membership: service-role queries against `organization_memberships`.
 *   - Organization creation: the atomic `create_organization` RPC (service
 *     role, security definer).
 *
 * The anon/publishable key is used ONLY for server-side token validation and
 * the service-role key is used ONLY here (backend). Neither reaches the
 * browser.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import {
  AuthError,
  type AuthenticatedUser,
  type AuthService,
  type OrganizationMembership,
} from "@departify/auth";
import type {
  OrganizationStore,
  OrganizationSummary,
} from "./tenant-contracts.js";

export class SupabaseTenantService implements AuthService, OrganizationStore {
  private readonly identity: SupabaseClient;
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.identity = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const { data, error } = await this.identity.auth.getUser(token);
    if (error || !data.user) {
      if (isExpiredTokenError(error)) {
        throw new AuthError("expired_token", "Authentication token expired.");
      }
      throw new AuthError("invalid_token", "Authentication token is invalid.");
    }
    return {
      id: data.user.id,
      ...(data.user.email ? { email: data.user.email } : {}),
    };
  }

  async resolveMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    const { data, error } = await this.admin
      .from("organization_memberships")
      .select("organization_id, user_id, role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return {
      organizationId: data.organization_id,
      userId: data.user_id,
      role: data.role as OrganizationMembership["role"],
    };
  }

  async createOrganization(
    name: string,
    ownerId: string,
  ): Promise<OrganizationSummary> {
    const { data, error } = await this.admin.rpc("create_organization", {
      p_name: name,
      p_owner: ownerId,
    });
    if (error) {
      throw error;
    }
    return {
      organizationId: normalizeRpcUuid(data),
      name,
      role: "owner",
    };
  }

  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    const { data, error } = await this.admin
      .from("organization_memberships")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", userId);
    if (error) {
      throw error;
    }
    return (data ?? []).map((row) => {
      const org = row.organizations as
        | { name?: string }
        | Array<{ name?: string }>
        | null;
      const orgName = Array.isArray(org) ? org[0]?.name : org?.name;
      return {
        organizationId: row.organization_id,
        name: orgName ?? row.organization_id,
        role: row.role as OrganizationSummary["role"],
      };
    });
  }
}

function isExpiredTokenError(error: { message?: string } | null): boolean {
  if (!error?.message) return false;
  return error.message.toLowerCase().includes("expired");
}

function normalizeRpcUuid(data: unknown): string {
  if (typeof data === "string" && data.length > 0) {
    return data;
  }
  if (Array.isArray(data)) {
    const first = data[0];
    if (typeof first === "string" && first.length > 0) {
      return first;
    }
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const id = record["id"] ?? record["organization_id"];
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  throw new Error("create_organization did not return an organization id.");
}

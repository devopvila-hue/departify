/**
 * Server-only OAuth token storage for non-Google business connectors.
 *
 * The portal, OpenClaw and logs only receive summaries. Raw access tokens are
 * available to provider adapters through this boundary and are scoped by
 * organization + authorizing user + provider.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

export type ExternalOAuthProvider =
  | "meta_business"
  | "meta_instagram"
  | "ticktick"
  | "github"
  | "tiktok"
  | "tiktok_business";

export interface ExternalOAuthAccountOption {
  readonly id: string;
  readonly label: string;
  readonly kind: "advertiser" | "business" | "profile";
}

export interface ExternalOAuthTokenRecord {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: ExternalOAuthProvider;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string | null;
  readonly refreshExpiresAt?: string | null;
  readonly scopes: readonly string[];
  readonly accountLabel: string | null;
  readonly accountOptions?: readonly ExternalOAuthAccountOption[];
  readonly selectedAccountRef?: string | null;
  readonly operationalVerifiedAt: string | null;
  readonly operationalProbeError: string | null;
}

export interface ExternalOAuthTokenSummary {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: ExternalOAuthProvider;
  readonly hasAccessToken: boolean;
  readonly hasRefreshToken: boolean;
  readonly expiresAt: string | null;
  readonly refreshExpiresAt?: string | null;
  readonly scopes: readonly string[];
  readonly accountLabel: string | null;
  readonly accountOptions?: readonly ExternalOAuthAccountOption[];
  readonly selectedAccountRef?: string | null;
  readonly operationalVerifiedAt: string | null;
  readonly operationalProbeError: string | null;
}

export interface ExternalOAuthTokenStore {
  put(record: ExternalOAuthTokenRecord): Promise<void>;
  get(
    organizationId: string,
    userId: string,
    provider: ExternalOAuthProvider,
  ): Promise<ExternalOAuthTokenRecord | null>;
  listForOrg(organizationId: string): Promise<readonly ExternalOAuthTokenSummary[]>;
  remove(
    organizationId: string,
    userId: string,
    provider: ExternalOAuthProvider,
  ): Promise<void>;
}

export function summarizeExternalOAuthToken(
  record: ExternalOAuthTokenRecord,
): ExternalOAuthTokenSummary {
  return {
    organizationId: record.organizationId,
    userId: record.userId,
    provider: record.provider,
    hasAccessToken: Boolean(record.accessToken),
    hasRefreshToken: Boolean(record.refreshToken),
    expiresAt: record.expiresAt,
    ...(record.refreshExpiresAt !== undefined ? { refreshExpiresAt: record.refreshExpiresAt } : {}),
    scopes: record.scopes,
    accountLabel: record.accountLabel,
    ...(record.accountOptions ? { accountOptions: record.accountOptions } : {}),
    ...(record.selectedAccountRef !== undefined ? { selectedAccountRef: record.selectedAccountRef } : {}),
    operationalVerifiedAt: record.operationalVerifiedAt,
    operationalProbeError: record.operationalProbeError,
  };
}

class InMemoryExternalOAuthTokenStore implements ExternalOAuthTokenStore {
  private readonly records = new Map<string, ExternalOAuthTokenRecord>();

  private key(
    organizationId: string,
    userId: string,
    provider: ExternalOAuthProvider,
  ): string {
    return `${organizationId}:${userId}:${provider}`;
  }

  async put(record: ExternalOAuthTokenRecord): Promise<void> {
    this.records.set(this.key(record.organizationId, record.userId, record.provider), record);
  }

  async get(
    organizationId: string,
    userId: string,
    provider: ExternalOAuthProvider,
  ): Promise<ExternalOAuthTokenRecord | null> {
    return this.records.get(this.key(organizationId, userId, provider)) ?? null;
  }

  async listForOrg(organizationId: string): Promise<readonly ExternalOAuthTokenSummary[]> {
    return [...this.records.values()]
      .filter((record) => record.organizationId === organizationId)
      .map(summarizeExternalOAuthToken);
  }

  async remove(
    organizationId: string,
    userId: string,
    provider: ExternalOAuthProvider,
  ): Promise<void> {
    this.records.delete(this.key(organizationId, userId, provider));
  }
}

interface ExternalOAuthTokenRow {
  organization_id: string;
  user_id: string;
  provider: ExternalOAuthProvider;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  refresh_expires_at?: string | null;
  scopes: string[];
  account_label: string | null;
  account_options?: ExternalOAuthAccountOption[] | null;
  selected_account_ref?: string | null;
  operational_verified_at: string | null;
  operational_probe_error: string | null;
}

function fromRow(row: ExternalOAuthTokenRow): ExternalOAuthTokenRecord {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    refreshExpiresAt: row.refresh_expires_at ?? null,
    scopes: row.scopes ?? [],
    accountLabel: row.account_label,
    accountOptions: row.account_options ?? [],
    selectedAccountRef: row.selected_account_ref ?? null,
    operationalVerifiedAt: row.operational_verified_at,
    operationalProbeError: row.operational_probe_error,
  };
}

export class SupabaseExternalOAuthTokenStore implements ExternalOAuthTokenStore {
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

  async put(record: ExternalOAuthTokenRecord): Promise<void> {
    const { error } = await this.admin.from("external_oauth_tokens").upsert(
      {
        organization_id: record.organizationId,
        user_id: record.userId,
        provider: record.provider,
        access_token: record.accessToken,
        refresh_token: record.refreshToken,
        expires_at: record.expiresAt,
        refresh_expires_at: record.refreshExpiresAt ?? null,
        scopes: [...record.scopes],
        account_label: record.accountLabel,
        account_options: record.accountOptions ?? [],
        selected_account_ref: record.selectedAccountRef ?? null,
        operational_verified_at: record.operationalVerifiedAt,
        operational_probe_error: record.operationalProbeError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id,provider" },
    );
    if (error) throw error;
  }

  async get(
    organizationId: string,
    userId: string,
    provider: ExternalOAuthProvider,
  ): Promise<ExternalOAuthTokenRecord | null> {
    const { data, error } = await this.admin
      .from("external_oauth_tokens")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as ExternalOAuthTokenRow) : null;
  }

  async listForOrg(organizationId: string): Promise<readonly ExternalOAuthTokenSummary[]> {
    const { data, error } = await this.admin
      .from("external_oauth_tokens")
      .select("organization_id,user_id,provider,access_token,refresh_token,expires_at,refresh_expires_at,scopes,account_label,account_options,selected_account_ref,operational_verified_at,operational_probe_error")
      .eq("organization_id", organizationId);
    if (error) throw error;
    return (data as ExternalOAuthTokenRow[]).map(summarizeExternalOAuthTokenFromRow);
  }

  async remove(
    organizationId: string,
    userId: string,
    provider: ExternalOAuthProvider,
  ): Promise<void> {
    const { error } = await this.admin
      .from("external_oauth_tokens")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("provider", provider);
    if (error) throw error;
  }
}

function summarizeExternalOAuthTokenFromRow(
  row: ExternalOAuthTokenRow,
): ExternalOAuthTokenSummary {
  return summarizeExternalOAuthToken(fromRow(row));
}

const inMemoryExternalOAuthTokenStore = new InMemoryExternalOAuthTokenStore();
let installedExternalOAuthTokenStore: ExternalOAuthTokenStore | null = null;

export function setExternalOAuthTokenStore(store: ExternalOAuthTokenStore): void {
  installedExternalOAuthTokenStore = store;
}

export function installExternalOAuthTokenStoreForTest(
  store: ExternalOAuthTokenStore | null,
): void {
  installedExternalOAuthTokenStore = store;
}

export function getExternalOAuthTokenStore(): ExternalOAuthTokenStore {
  return installedExternalOAuthTokenStore ?? inMemoryExternalOAuthTokenStore;
}

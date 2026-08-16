/**
 * Organization-owned BYOK for the supported LLM capability.
 *
 * The store follows the existing server-only credential-vault pattern used
 * by marketing connectors and corporate email: only the backend can read the
 * secret, while the portal receives status and human-readable metadata.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

export const BYOK_PROVIDER = "openai" as const;
export const BYOK_DEFAULT_MODEL = "gpt-4o-mini" as const;

export interface LlmCredentialRecord {
  readonly organizationId: string;
  readonly provider: typeof BYOK_PROVIDER;
  readonly model: string;
  /** Server-only secret. Never serialize this record to a client. */
  readonly apiKey: string;
  readonly createdBy: string | null;
  readonly verifiedAt: string | null;
  readonly lastError: string | null;
}

export interface LlmCredentialSummary {
  readonly provider: typeof BYOK_PROVIDER;
  readonly model: string;
  readonly configured: boolean;
  readonly verifiedAt: string | null;
  readonly lastError: string | null;
}

export interface LlmCredentialStore {
  get(organizationId: string, provider: typeof BYOK_PROVIDER): Promise<LlmCredentialRecord | null>;
  put(record: LlmCredentialRecord): Promise<void>;
  remove(organizationId: string, provider: typeof BYOK_PROVIDER): Promise<boolean>;
}

let installedStore: LlmCredentialStore | null = null;

export function setLlmCredentialStore(store: LlmCredentialStore): void {
  installedStore = store;
}

export function getLlmCredentialStore(): LlmCredentialStore {
  if (installedStore) return installedStore;
  installedStore = new InMemoryLlmCredentialStore();
  return installedStore;
}

export function createInMemoryLlmCredentialStore(): LlmCredentialStore {
  return new InMemoryLlmCredentialStore();
}

class InMemoryLlmCredentialStore implements LlmCredentialStore {
  private readonly records = new Map<string, LlmCredentialRecord>();

  private key(organizationId: string, provider: string): string {
    return `${organizationId}:${provider}`;
  }

  async get(organizationId: string, provider: typeof BYOK_PROVIDER): Promise<LlmCredentialRecord | null> {
    return this.records.get(this.key(organizationId, provider)) ?? null;
  }

  async put(record: LlmCredentialRecord): Promise<void> {
    this.records.set(this.key(record.organizationId, record.provider), record);
  }

  async remove(organizationId: string, provider: typeof BYOK_PROVIDER): Promise<boolean> {
    return this.records.delete(this.key(organizationId, provider));
  }
}

interface LlmCredentialRow {
  organization_id: string;
  provider: typeof BYOK_PROVIDER;
  model: string;
  api_key: string;
  created_by: string | null;
  verified_at: string | null;
  last_error: string | null;
}

export class SupabaseLlmCredentialStore implements LlmCredentialStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async get(organizationId: string, provider: typeof BYOK_PROVIDER): Promise<LlmCredentialRecord | null> {
    const { data, error } = await this.admin
      .from("organization_llm_credentials")
      .select("organization_id,provider,model,api_key,created_by,verified_at,last_error")
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as LlmCredentialRow) : null;
  }

  async put(record: LlmCredentialRecord): Promise<void> {
    const { error } = await this.admin.from("organization_llm_credentials").upsert(
      {
        organization_id: record.organizationId,
        provider: record.provider,
        model: record.model,
        api_key: record.apiKey,
        created_by: record.createdBy,
        verified_at: record.verifiedAt,
        last_error: record.lastError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,provider" },
    );
    if (error) throw error;
  }

  async remove(organizationId: string, provider: typeof BYOK_PROVIDER): Promise<boolean> {
    const { data, error } = await this.admin
      .from("organization_llm_credentials")
      .delete()
      .eq("organization_id", organizationId)
      .eq("provider", provider)
      .select("provider");
    if (error) throw error;
    return Boolean(data?.length);
  }
}

function mapRow(row: LlmCredentialRow): LlmCredentialRecord {
  return {
    organizationId: row.organization_id,
    provider: row.provider,
    model: row.model,
    apiKey: row.api_key,
    createdBy: row.created_by,
    verifiedAt: row.verified_at,
    lastError: row.last_error,
  };
}

export function summarizeLlmCredential(
  record: LlmCredentialRecord | null,
): LlmCredentialSummary {
  return {
    provider: BYOK_PROVIDER,
    model: record?.model ?? BYOK_DEFAULT_MODEL,
    configured: Boolean(record?.apiKey),
    verifiedAt: record?.verifiedAt ?? null,
    lastError: record?.lastError ?? null,
  };
}

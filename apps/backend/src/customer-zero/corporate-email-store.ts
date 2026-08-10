/**
 * Corporate email account store — Customer Zero Email P0.
 *
 * "Otro correo de empresa" (IMAP read + SMTP send) credentials live
 * here, org+user scoped, server-only, following the SAME security
 * pattern as `google_oauth_tokens`:
 *
 *   - service-role only; RLS blocks authenticated roles entirely.
 *   - the password is never returned to the portal, never logged, never
 *     placed in Company DNA / chat / model context.
 *   - `operationalVerifiedAt` is set only after a real bounded
 *     IMAP+SMTP probe succeeds; otherwise the connection is not
 *     "connected".
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

export interface CorporateEmailAccount {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: "imap_smtp";
  readonly email: string;
  readonly username: string;
  /** App password — NEVER serialized to the portal. */
  readonly password: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapSecure: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecure: boolean;
  readonly displayName: string | null;
  readonly operationalVerifiedAt: string | null;
  readonly operationalProbeError: string | null;
}

/** Public-safe view — no password, no username internals beyond email. */
export interface CorporateEmailSummary {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: "imap_smtp";
  readonly email: string;
  readonly hasCredentials: boolean;
  readonly operationalVerifiedAt: string | null;
  readonly operationalProbeError: string | null;
}

export interface CorporateEmailStore {
  put(account: CorporateEmailAccount): Promise<void>;
  get(
    organizationId: string,
    userId: string,
  ): Promise<CorporateEmailAccount | null>;
  listForOrg(organizationId: string): Promise<readonly CorporateEmailSummary[]>;
  remove(organizationId: string, userId: string): Promise<void>;
}

let installedStore: CorporateEmailStore | null = null;

export function setCorporateEmailStore(store: CorporateEmailStore): void {
  installedStore = store;
}

export function installCorporateEmailStore(
  store: CorporateEmailStore | null,
): void {
  installedStore = store;
}

export function getCorporateEmailStore(): CorporateEmailStore {
  if (installedStore) return installedStore;
  installedStore = new InMemoryCorporateEmailStore();
  return installedStore;
}

class InMemoryCorporateEmailStore implements CorporateEmailStore {
  private readonly map = new Map<string, CorporateEmailAccount>();

  private key(org: string, user: string): string {
    return `${org}::${user}`;
  }

  async put(account: CorporateEmailAccount): Promise<void> {
    this.map.set(this.key(account.organizationId, account.userId), account);
  }

  async get(
    organizationId: string,
    userId: string,
  ): Promise<CorporateEmailAccount | null> {
    return this.map.get(this.key(organizationId, userId)) ?? null;
  }

  async listForOrg(
    organizationId: string,
  ): Promise<readonly CorporateEmailSummary[]> {
    const out: CorporateEmailSummary[] = [];
    for (const rec of this.map.values()) {
      if (rec.organizationId === organizationId) {
        out.push(summarizeCorporateAccount(rec));
      }
    }
    return out;
  }

  async remove(organizationId: string, userId: string): Promise<void> {
    this.map.delete(this.key(organizationId, userId));
  }
}

export function createInMemoryCorporateEmailStore(): CorporateEmailStore {
  return new InMemoryCorporateEmailStore();
}

export function summarizeCorporateAccount(
  account: CorporateEmailAccount,
): CorporateEmailSummary {
  return {
    organizationId: account.organizationId,
    userId: account.userId,
    provider: account.provider,
    email: account.email,
    hasCredentials: true,
    operationalVerifiedAt: account.operationalVerifiedAt,
    operationalProbeError: account.operationalProbeError,
  };
}

interface EmailAccountRow {
  organization_id: string;
  user_id: string;
  provider: "imap_smtp";
  email: string;
  username: string;
  password: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  display_name: string | null;
  operational_verified_at: string | null;
  operational_probe_error: string | null;
}

export class SupabaseCorporateEmailStore implements CorporateEmailStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(
      config.supabaseUrl,
      config.supabaseServiceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      },
    );
  }

  async put(account: CorporateEmailAccount): Promise<void> {
    const { error } = await this.admin.from("email_accounts").upsert(
      {
        organization_id: account.organizationId,
        user_id: account.userId,
        provider: account.provider,
        email: account.email,
        username: account.username,
        password: account.password,
        imap_host: account.imapHost,
        imap_port: account.imapPort,
        imap_secure: account.imapSecure,
        smtp_host: account.smtpHost,
        smtp_port: account.smtpPort,
        smtp_secure: account.smtpSecure,
        display_name: account.displayName,
        operational_verified_at: account.operationalVerifiedAt,
        operational_probe_error: account.operationalProbeError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id,provider" },
    );
    if (error) throw error;
  }

  async get(
    organizationId: string,
    userId: string,
  ): Promise<CorporateEmailAccount | null> {
    const { data, error } = await this.admin
      .from("email_accounts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as EmailAccountRow;
    return {
      organizationId: row.organization_id,
      userId: row.user_id,
      provider: row.provider,
      email: row.email,
      username: row.username,
      password: row.password,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapSecure: row.imap_secure,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpSecure: row.smtp_secure,
      displayName: row.display_name,
      operationalVerifiedAt: row.operational_verified_at,
      operationalProbeError: row.operational_probe_error,
    };
  }

  async listForOrg(
    organizationId: string,
  ): Promise<readonly CorporateEmailSummary[]> {
    const { data, error } = await this.admin
      .from("email_accounts")
      .select("*")
      .eq("organization_id", organizationId);
    if (error) throw error;
    return (data ?? []).map((row) => {
      const r = row as EmailAccountRow;
      return {
        organizationId: r.organization_id,
        userId: r.user_id,
        provider: r.provider,
        email: r.email,
        hasCredentials: true,
        operationalVerifiedAt: r.operational_verified_at,
        operationalProbeError: r.operational_probe_error,
      };
    });
  }

  async remove(organizationId: string, userId: string): Promise<void> {
    const { error } = await this.admin
      .from("email_accounts")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId);
    if (error) throw error;
  }
}

/**
 * Durable OAuth state store — Phase P-B.
 *
 * The Google OAuth handshake binds each authorization attempt to its
 * (organization, user, requested capability, returnPath) through a random `state`
 * nonce. In Railway the backend may run several replicas and every
 * deploy restarts instances: an in-memory state store breaks the
 * handshake between the `connect` request and the `callback` request
 * (nonce not found → invalid_state → the CEO lands back on
 * "no conectado" and repeats the consent loop).
 *
 * This module owns:
 *
 *   1. The `OAuthStateRecord` shape.
 *   2. The `OAuthStateStore` boundary the OAuth start + callback paths
 *      depend on.
 *   3. The InMemory + Supabase adapters; main.ts wires the Supabase
 *      adapter at boot when durable persistence is available.
 *
 * Privacy contract:
 *   - The nonce is a random opaque value; the row never carries the
 *     authorization code, tokens or the client secret.
 *   - Only the org/user/capability binding + expiry are stored. Server-only via
 *     service role; RLS blocks authenticated roles entirely.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";

/** The binding stored alongside an OAuth state nonce. */
export interface OAuthStateRecord {
  readonly nonce: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly connectionIntent: "marketing" | "admin";
  /** The bounded Google catalog capability that started this handshake. */
  readonly requestedToolId?: OAuthRequestedToolId;
  readonly returnPath: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** When true the state has been consumed (single use). */
  readonly consumed?: boolean;
}

/** Catalog tool that may initiate a server-owned OAuth handshake. */
export type OAuthRequestedToolId =
  | "gmail"
  | "google_workspace"
  | "google_calendar"
  | "google_drive"
  | "youtube"
  | "meta_business"
  | "ticktick";

/** Durable OAuth state boundary. Async: the durable adapter needs I/O. */
export interface OAuthStateStore {
  put(state: OAuthStateRecord): Promise<void>;
  get(nonce: string): Promise<OAuthStateRecord | null>;
  consume(nonce: string): Promise<OAuthStateRecord | null>;
}

/* ----------------------------------------------------------------------------
 * Active store — DI boundary.
 * --------------------------------------------------------------------------*/

let installedStateStore: OAuthStateStore | null = null;

/** Production main.ts calls this once at boot when Supabase is available. */
export function setGoogleOAuthStateStore(store: OAuthStateStore): void {
  installedStateStore = store;
}

/** Test helpers may install an isolated store between cases. */
export function installGoogleOAuthStateStore(
  store: OAuthStateStore | null,
): void {
  installedStateStore = store;
}

/**
 * Resolve the active store. Falls back to the shared in-memory
 * implementation (the same instance tests seed directly) when no
 * durable store has been wired. Production must wire Supabase at
 * boot — the in-memory fallback is for tests and early development
 * only.
 */
export function getGoogleOAuthStateStore(): OAuthStateStore {
  if (installedStateStore) return installedStateStore;
  return gmailOAuthStateStore;
}

/* ----------------------------------------------------------------------------
 * In-memory implementation (default).
 * --------------------------------------------------------------------------*/

class InMemoryOAuthStateStoreImpl implements OAuthStateStore {
  private readonly entries = new Map<string, OAuthStateRecord>();

  async put(state: OAuthStateRecord): Promise<void> {
    this.entries.set(state.nonce, state);
  }

  async get(nonce: string): Promise<OAuthStateRecord | null> {
    const state = this.entries.get(nonce);
    if (!state) return null;
    if (new Date(state.expiresAt).getTime() < Date.now()) {
      this.entries.delete(nonce);
      return null;
    }
    return state;
  }

  async consume(nonce: string): Promise<OAuthStateRecord | null> {
    const state = await this.get(nonce);
    if (!state) return null;
    this.entries.set(nonce, { ...state, consumed: true });
    return state;
  }

  /** Test helper: clear all entries. */
  reset(): void {
    this.entries.clear();
  }
}

/**
 * The shared default in-memory store. Tests seed this instance directly
 * (it keeps the legacy `gmailOAuthStateStore` contract) and it is the
 * fallback when no durable store is installed.
 */
export const gmailOAuthStateStore: OAuthStateStore =
  new InMemoryOAuthStateStoreImpl();

/** Test-only explicit constructor. */
export function createInMemoryOAuthStateStore(): OAuthStateStore {
  return new InMemoryOAuthStateStoreImpl();
}

/* ----------------------------------------------------------------------------
 * Supabase adapter — production.
 *
 * Backed by the `oauth_state` table. Service-role only; RLS denies
 * authenticated roles. Durable across Railway restarts and replicas.
 * --------------------------------------------------------------------------*/

interface OAuthStateRow {
  nonce: string;
  organization_id: string;
  user_id: string;
  connection_intent: "marketing" | "admin";
  requested_tool_id: OAuthStateRecord["requestedToolId"] | null;
  return_path: string | null;
  created_at: string;
  expires_at: string;
  consumed: boolean;
}

function toRecord(row: OAuthStateRow): OAuthStateRecord {
  return {
    nonce: row.nonce,
    organizationId: row.organization_id,
    userId: row.user_id,
    connectionIntent: row.connection_intent,
    ...(row.requested_tool_id ? { requestedToolId: row.requested_tool_id } : {}),
    returnPath: row.return_path ?? "",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumed: row.consumed,
  };
}

export class SupabaseOAuthStateStore implements OAuthStateStore {
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

  async put(state: OAuthStateRecord): Promise<void> {
    const { error } = await this.admin
      .from("oauth_state")
      .upsert(
        {
          nonce: state.nonce,
          organization_id: state.organizationId,
          user_id: state.userId,
          connection_intent: state.connectionIntent,
          requested_tool_id: state.requestedToolId ?? "gmail",
          return_path: state.returnPath,
          created_at: state.createdAt,
          expires_at: state.expiresAt,
          consumed: Boolean(state.consumed),
        },
        { onConflict: "nonce" },
      );
    if (error) {
      throw error;
    }
  }

  async get(nonce: string): Promise<OAuthStateRecord | null> {
    const { data, error } = await this.admin
      .from("oauth_state")
      .select("*")
      .eq("nonce", nonce)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) return null;
    const record = toRecord(data as OAuthStateRow);
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      // Housekeeping: drop the expired nonce so the table does not grow
      // unboundedly and the caller sees an honest miss.
      void this.admin.from("oauth_state").delete().eq("nonce", nonce);
      return null;
    }
    return record;
  }

  async consume(nonce: string): Promise<OAuthStateRecord | null> {
    const { data, error } = await this.admin
      .from("oauth_state")
      .select("*")
      .eq("nonce", nonce)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) return null;
    const record = toRecord(data as OAuthStateRow);
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      void this.admin.from("oauth_state").delete().eq("nonce", nonce);
      return null;
    }
    await this.admin
      .from("oauth_state")
      .update({ consumed: true })
      .eq("nonce", nonce);
    return { ...record, consumed: true };
  }
}

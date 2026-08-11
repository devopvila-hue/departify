/**
 * Google OAuth token store — Phase P-B (CZ P0 recovery).
 *
 * The unified Google identity (gmail, google_workspace,
 * google_calendar, google_drive) shares ONE OAuth client. The
 * resulting refresh tokens MUST survive Railway backend restarts so
 * the CEO never has to re-consent on every deploy.
 *
 * This module owns:
 *
 *   1. The `GoogleTokenRecord` shape and the public-safe summary.
 *   2. The `GoogleTokenStore` interface — the boundary the route
 *      handler depends on. The token VALUES never leave the
 *      boundary; the portal never sees them, the model never sees
 *      them.
 *   3. The InMemory + Supabase adapters; main.ts wires the Supabase
 *      adapter at boot when durable persistence is available.
 *   4. The `refreshGoogleToken` helper that rotates access tokens
 *      using the persistent refresh token.
 *   5. The `probeGmailOperational` lightweight capability probe —
 *      `GET gmail.users.getProfile("me")` — used by the callback
 *      route to mark a connection `operational` only after Google
 *      actually accepted the credentials.
 *
 * Privacy contract:
 *   - Token VALUES never enter logs.
 *   - Token VALUES never enter the portal response.
 *   - Token VALUES never enter Company DNA / chat history /
 *     department memory.
 *   - Granted scopes ARE persisted so the capability surface is
 *     derived from what Google actually authorized, not what we
 *     requested.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type { GmailTokens } from "./gmail-adapter.js";
import { gmailTokenStore } from "./gmail-adapter.js";

/** Provider scope a token row may belong to. */
export type GoogleTokenProvider =
  | "gmail"
  | "google_workspace"
  | "google_calendar"
  | "google_drive";

/** OAuth scopes required by the business capabilities we expose. */
export const GOOGLE_CAPABILITY_SCOPES = {
  "email.read": ["https://www.googleapis.com/auth/gmail.readonly"],
  "email.compose": ["https://www.googleapis.com/auth/gmail.compose"],
  "email.send": ["https://www.googleapis.com/auth/gmail.send"],
  "calendar.read": ["https://www.googleapis.com/auth/calendar.readonly"],
  "calendar.create": ["https://www.googleapis.com/auth/calendar.events"],
  "drive.search": ["https://www.googleapis.com/auth/drive.readonly"],
  "drive.read": ["https://www.googleapis.com/auth/drive.readonly"],
} as const;

export type GoogleCapability = keyof typeof GOOGLE_CAPABILITY_SCOPES;

/** Persisted Google token row. NEVER serialized to the portal. */
export interface GoogleTokenRecord {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: GoogleTokenProvider;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  readonly email: string;
  readonly displayName: string | null;
  readonly operationalVerifiedAt: string | null;
  readonly operationalProbeError: string | null;
  /** Capabilities covered by the last successful bounded probes. */
  readonly operationalCapabilities?: readonly GoogleCapability[];
}

/**
 * Public-safe summary of a token row. Surfaces every property except
 * the token VALUES themselves. Used by the /conexiones UI and
 * capability registry, never includes access / refresh tokens.
 */
export interface GoogleTokenSummary {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: GoogleTokenProvider;
  readonly hasRefreshToken: boolean;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  readonly email: string;
  readonly displayName: string | null;
  readonly operationalVerifiedAt: string | null;
  readonly operationalProbeError: string | null;
  readonly operationalCapabilities?: readonly GoogleCapability[];
}

export interface GoogleTokenStore {
  put(record: GoogleTokenRecord): Promise<void>;
  get(
    organizationId: string,
    userId: string,
  ): Promise<GoogleTokenRecord | null>;
  /**
   * List all token rows for an organization. Used by the /conexiones
   * surface and chat capability registry to read the operational
   * identity regardless of which user originally authorised it.
   *
   * Returns summaries only — never the access / refresh token values.
   */
  listForOrg(organizationId: string): Promise<readonly GoogleTokenSummary[]>;
  remove(organizationId: string, userId: string): Promise<void>;
}

/** Convert a `GoogleTokenRecord` into a public-safe summary. */
export function summarize(record: GoogleTokenRecord): GoogleTokenSummary {
  return {
    organizationId: record.organizationId,
    userId: record.userId,
    provider: record.provider,
    hasRefreshToken: Boolean(record.refreshToken),
    expiresAt: record.expiresAt,
    scopes: record.scopes,
    email: record.email,
    displayName: record.displayName,
    operationalVerifiedAt: record.operationalVerifiedAt,
    operationalProbeError: record.operationalProbeError,
    ...(record.operationalCapabilities
      ? { operationalCapabilities: record.operationalCapabilities }
      : {}),
  };
}

/* ----------------------------------------------------------------------------
 * Token store interface — DI boundary.
 *
 * The route handler depends only on this interface. Production wires
 * the Supabase adapter; tests wire an InMemory adapter.
 * --------------------------------------------------------------------------*/

let installedStore: GoogleTokenStore | null = null;

/** Production main.ts calls this once at boot when Supabase is available. */
export function setGoogleTokenStore(store: GoogleTokenStore): void {
  installedStore = store;
}

/** Test helpers may install an isolated store between cases. */
export function installGoogleTokenStore(
  store: GoogleTokenStore | null,
): void {
  installedStore = store;
}

/**
 * Resolve the active store. Falls back to a process-local in-memory
 * implementation when no durable store has been wired. Production must
 * wire Supabase at boot — the in-memory fallback is for tests and
 * early development only.
 */
export function getGoogleTokenStore(): GoogleTokenStore {
  if (installedStore) return installedStore;
  installedStore = new InMemoryGoogleTokenStore();
  return installedStore;
}

/* ----------------------------------------------------------------------------
 * In-memory implementation.
 *
 * Suitable for tests and dev. Process restart destroys the tokens.
 * NOT acceptable for production.
 * --------------------------------------------------------------------------*/

class InMemoryGoogleTokenStore implements GoogleTokenStore {
  private readonly map = new Map<string, GoogleTokenRecord>();

  private key(organizationId: string, userId: string): string {
    return `${organizationId}::${userId}`;
  }

  async put(record: GoogleTokenRecord): Promise<void> {
    this.map.set(this.key(record.organizationId, record.userId), {
      ...record,
      provider: "gmail",
    });
  }

  async get(
    organizationId: string,
    userId: string,
  ): Promise<GoogleTokenRecord | null> {
    return this.map.get(this.key(organizationId, userId)) ?? null;
  }

  async remove(organizationId: string, userId: string): Promise<void> {
    this.map.delete(this.key(organizationId, userId));
  }

  async listForOrg(
    organizationId: string,
  ): Promise<readonly GoogleTokenSummary[]> {
    const out: GoogleTokenSummary[] = [];
    for (const rec of this.map.values()) {
      if (rec.organizationId === organizationId) {
        out.push({
          organizationId: rec.organizationId,
          userId: rec.userId,
          provider: rec.provider,
          hasRefreshToken: Boolean(rec.refreshToken),
          expiresAt: rec.expiresAt,
          scopes: rec.scopes,
          email: rec.email,
          displayName: rec.displayName,
          operationalVerifiedAt: rec.operationalVerifiedAt,
          operationalProbeError: rec.operationalProbeError,
          ...(rec.operationalCapabilities
            ? { operationalCapabilities: rec.operationalCapabilities }
            : {}),
        });
      }
    }
    return out;
  }

  /**
   * Test helper: clear all in-memory records. Production tokens are
   * managed by Supabase and never use this method.
   */
  reset(): void {
    this.map.clear();
  }
}

/** Test-only explicit constructor. */
export function createInMemoryGoogleTokenStore(): GoogleTokenStore {
  return new InMemoryGoogleTokenStore();
}

/* ----------------------------------------------------------------------------
 * Supabase adapter — production.
 *
 * Backed by the `google_oauth_tokens` table. Uses service-role only;
 * the RLS policy denies direct read access by authenticated users so
 * that even a misconfigured portal cannot fetch tokens.
 *
 * Token persistence is durable. Railway backend restarts do NOT
 * destroy credentials.
 * --------------------------------------------------------------------------*/

interface GoogleTokenRow {
  organization_id: string;
  user_id: string;
  provider: GoogleTokenProvider;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scopes: string[];
  email: string;
  display_name: string | null;
  operational_verified_at: string | null;
  operational_probe_error: string | null;
  operational_capabilities?: string[] | null;
  updated_at: string;
}

export class SupabaseGoogleTokenStore implements GoogleTokenStore {
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

  async put(record: GoogleTokenRecord): Promise<void> {
    // The provider field is retained for backwards-compatible row decoding,
    // but credentials are one Google identity. Never create a second row for
    // Calendar or Drive.
    const canonicalProvider: GoogleTokenProvider = "gmail";
    const { error } = await this.admin
      .from("google_oauth_tokens")
      .upsert(
        {
          organization_id: record.organizationId,
          user_id: record.userId,
          provider: canonicalProvider,
          access_token: record.accessToken,
          refresh_token: record.refreshToken,
          expires_at: record.expiresAt,
          scopes: [...record.scopes],
          email: record.email,
          display_name: record.displayName,
          operational_verified_at: record.operationalVerifiedAt,
          operational_probe_error: record.operationalProbeError,
          operational_capabilities: record.operationalCapabilities ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,user_id" },
      );
    if (error) throw error;
  }

  async get(
    organizationId: string,
    userId: string,
  ): Promise<GoogleTokenRecord | null> {
    const { data, error } = await this.admin
      .from("google_oauth_tokens")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as GoogleTokenRow;
    return {
      organizationId: row.organization_id,
      userId: row.user_id,
      provider: row.provider,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
      scopes: row.scopes ?? [],
      email: row.email,
      displayName: row.display_name,
      operationalVerifiedAt: row.operational_verified_at,
      operationalProbeError: row.operational_probe_error,
      ...(row.operational_capabilities
        ? { operationalCapabilities: row.operational_capabilities as GoogleCapability[] }
        : {}),
    };
  }

  async remove(organizationId: string, userId: string): Promise<void> {
    const { error } = await this.admin
      .from("google_oauth_tokens")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async listForOrg(
    organizationId: string,
  ): Promise<readonly GoogleTokenSummary[]> {
    const { data, error } = await this.admin
      .from("google_oauth_tokens")
      .select("*")
      .eq("organization_id", organizationId);
    if (error) throw error;
    return (data ?? []).map((row) => {
      const r = row as GoogleTokenRow;
      return {
        organizationId: r.organization_id,
        userId: r.user_id,
        provider: r.provider,
        hasRefreshToken: Boolean(r.refresh_token),
        expiresAt: r.expires_at,
        scopes: r.scopes ?? [],
        email: r.email,
        displayName: r.display_name,
        operationalVerifiedAt: r.operational_verified_at,
        operationalProbeError: r.operational_probe_error,
        ...(r.operational_capabilities
          ? { operationalCapabilities: r.operational_capabilities as GoogleCapability[] }
          : {}),
      };
    });
  }
}

/* ----------------------------------------------------------------------------
 * Refresh-token rotation.
 *
 * When the access token is near its expiry, exchange the persistent
 * refresh token for a fresh access token at Google's token endpoint.
 * Never log the new access / refresh tokens. The function takes the
 * production credentials (env) so the model and the portal never see
 * the secret values.
 * --------------------------------------------------------------------------*/

/**
 * Bounded timeout for outbound Google API calls. An external call must
 * never hang the callback request: "connecting forever" is not an
 * acceptable terminal state. 15s is generous for Google's endpoints
 * and far below Railway's request timeout.
 */
const GOOGLE_CALL_TIMEOUT_MS = 15_000;

export function googleApiFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = GOOGLE_CALL_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.any([
      init.signal as AbortSignal | undefined,
      AbortSignal.timeout(timeoutMs),
    ].filter(Boolean) as AbortSignal[]),
  });
}

export interface RefreshInput {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface RefreshOutput {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
}

export async function refreshGoogleToken(
  input: RefreshInput,
): Promise<RefreshOutput> {
  const response = await googleApiFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(
      `Google token refresh returned ${response.status}`,
    );
  }
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) {
    throw new Error("Google token refresh missing access_token");
  }
  return {
    accessToken: json.access_token,
    expiresAt: new Date(
      Date.now() + (json.expires_in ?? 3600) * 1000,
    ).toISOString(),
    scopes: (json.scope ?? "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/* ----------------------------------------------------------------------------
 * OAuth callback — granted-scope parsing and refresh-token preservation.
 *
 * When Google returns a token response, some fields may be empty:
 *
 *   - Google may not return a new `refresh_token` on every reconnect;
 *     the existing persistent refresh token must be preserved.
 *   - The `scope` returned in the token body is the set of scopes the
 *     user ACTUALLY granted. This may differ from the requested set.
 *
 * `mergeTokenExchange` never overwrites a stored refresh token with
 * `undefined`/`null` and replaces scopes with the granted set.
 * --------------------------------------------------------------------------*/

export interface TokenExchangeResponse {
  readonly access_token: string | null;
  readonly refresh_token?: string | null;
  readonly expires_in?: number | null;
  readonly scope?: string | null;
  readonly token_type?: string | null;
  readonly id_token?: string | null;
}

export interface MergeInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: GoogleTokenProvider;
  readonly exchange: TokenExchangeResponse;
  /** Stored refresh token from a previous successful exchange, if any. */
  readonly previousRefreshToken: string | null;
  /** Stored granted scopes from a previous successful exchange, if any. */
  readonly previousScopes: readonly string[];
  readonly email: string;
  readonly displayName: string | null;
  readonly nowMs: number;
}

export interface MergeOutput {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  readonly hasRefreshToken: boolean;
}

/**
 * Merge a fresh token exchange response into the stored state.
 * PRESERVES the existing refresh token if Google did not return one.
 * Replaces scopes with the GRANTED set (not the requested set).
 */
export function mergeTokenExchange(input: MergeInput): MergeOutput {
  if (!input.exchange.access_token) {
    throw new Error("Google token exchange missing access_token");
  }
  // Google may omit `refresh_token` on a reconnect. Treat a missing
  // (undefined), null or EMPTY value as "no new token" and PRESERVE the
  // previously stored refresh token — never overwrite a valid durable
  // token with an empty value.
  const rawRefresh = input.exchange.refresh_token;
  const newRefresh =
    typeof rawRefresh === "string" && rawRefresh.trim().length > 0
      ? rawRefresh
      : undefined;
  const refreshToken = newRefresh ?? input.previousRefreshToken ?? null;
  const expiresAt = new Date(
    input.nowMs + (input.exchange.expires_in ?? 3600) * 1000,
  ).toISOString();
  const grantedScopes = (input.exchange.scope ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  // If Google did not return scopes (unusual), fall back to whatever
  // was granted previously. If nothing, leave the granted-scopes list
  // empty — the capability surface will reflect that honestly.
  // Incremental consent must never remove an already granted capability. In
  // practice Google usually returns the union, but preserving the union here
  // also keeps the invariant true for providers/test doubles that omit it.
  const scopes = Array.from(new Set([
    ...input.previousScopes,
    ...grantedScopes.map(normalizeGoogleScope),
  ]));
  return {
    accessToken: input.exchange.access_token,
    refreshToken,
    expiresAt,
    scopes,
    hasRefreshToken: Boolean(refreshToken),
  };
}

function normalizeGoogleScope(scope: string): string {
  const aliases: Readonly<Record<string, string>> = {
    "gmail.readonly": "https://www.googleapis.com/auth/gmail.readonly",
    "gmail.compose": "https://www.googleapis.com/auth/gmail.compose",
    "gmail.send": "https://www.googleapis.com/auth/gmail.send",
    "calendar.readonly": "https://www.googleapis.com/auth/calendar.readonly",
    "calendar.events": "https://www.googleapis.com/auth/calendar.events",
    "drive.readonly": "https://www.googleapis.com/auth/drive.readonly",
  };
  return aliases[scope] ?? scope;
}

/* ----------------------------------------------------------------------------
 * Operational probe — Gmail users.getProfile("me").
 *
 * A connection is `operational` only when Google accepts the access
 * token on a real API call. The probe is intentionally tiny:
 *   GET https://gmail.googleapis.com/gmail/v1/users/me/profile
 *   Authorization: Bearer <accessToken>
 *
 * If the access token is expired the caller may rotate it via the
 * refresh token first; the route handler chooses the order.
 * --------------------------------------------------------------------------*/

export interface GmailOperationalProbeResult {
  readonly operational: boolean;
  readonly verifiedAt: string;
  readonly error: string | null;
}

export async function probeGmailOperational(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailOperationalProbeResult> {
  const now = new Date().toISOString();
  try {
    // The probe MUST be bounded: a hanging gmail API call must never
    // leave the connection in "connecting" forever.
    const response = await fetchImpl(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(GOOGLE_CALL_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return {
        operational: false,
        verifiedAt: now,
        error: `gmail_users_get_profile_${response.status}`,
      };
    }
    return {
      operational: true,
      verifiedAt: now,
      error: null,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown";
    const error = /abor|timeout/i.test(message)
      ? "gmail_probe_timeout"
      : message;
    return {
      operational: false,
      verifiedAt: now,
      error,
    };
  }
}

/** Bounded generic Google probe used by incremental Calendar/Drive consent. */
export async function probeGoogleOperational(
  accessToken: string,
  scopes: readonly string[],
  fetchImpl: typeof fetch = fetch,
  focus: GoogleTokenProvider = "gmail",
): Promise<GmailOperationalProbeResult> {
  if (focus === "gmail" && scopes.includes("https://www.googleapis.com/auth/gmail.readonly")) {
    return probeGmailOperational(accessToken, fetchImpl);
  }
  const now = new Date().toISOString();
  const calendar = focus === "google_calendar" ||
    (focus === "gmail" && (scopes.includes("https://www.googleapis.com/auth/calendar.readonly") ||
      scopes.includes("https://www.googleapis.com/auth/calendar.events")));
  const url = calendar
    ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&singleEvents=true"
    : "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)";
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_CALL_TIMEOUT_MS),
    });
    return response.ok
      ? { operational: true, verifiedAt: now, error: null }
      : { operational: false, verifiedAt: now, error: `google_probe_${response.status}` };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "unknown";
    return {
      operational: false,
      verifiedAt: now,
      error: /abor|timeout/i.test(message) ? "google_probe_timeout" : message,
    };
  }
}

/* ----------------------------------------------------------------------------
 * Re-export the existing GmailTokens type for backward compatibility.
 * --------------------------------------------------------------------------*/

/* ----------------------------------------------------------------------------
 * High-level OAuth callback pipeline.
 *
 *   1. State validation (delegated to `validateOAuthState`).
 *   2. Code exchange at Google token endpoint.
 *   3. Granted-scope parsing (replace previously stored scopes).
 *   4. Refresh-token preservation when Google omits refresh_token.
 *   5. Identity fetch.
 *   6. Operational probe (`gmail.users.getProfile`).
 *   7. Durable persistence via the active `GoogleTokenStore`.
 *
 * The route handler depends only on this function. Token VALUES never
 * leave this boundary — `result.record` includes the token values for
 * downstream adapter wiring, but is consumed by the same process
 * boundary and never serialized to the portal.
 * --------------------------------------------------------------------------*/

export interface CompleteGoogleOAuthInput {
  readonly code: string;
  readonly state: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly provider: GoogleTokenProvider;
  readonly identityProvider: "gmail";
  readonly stateNonceLookup: (
    nonce: string,
  ) => Promise<{
    organizationId: string;
    userId: string;
    returnPath?: string;
    requestedToolId?: GoogleTokenProvider;
    consumed?: boolean;
  } | null>;
  readonly stateNonceConsume: (nonce: string) => Promise<void>;
  readonly nowMs?: number;
  readonly probeFetcher?: typeof fetch;
  /**
   * Optional SAFE diagnostic checkpoint sink. Fires only safe
   * structured fields (never codes, tokens, secrets, headers).
   * The route wires it to request.log for the production trace.
   */
  readonly onCheckpoint?: (checkpoint: string, data: Record<string, unknown>) => void;
}

export interface CompleteGoogleOAuthResult {
  readonly record: GoogleTokenRecord;
  readonly identity: {
    readonly email: string;
    readonly displayName: string;
    readonly provider: "gmail";
  };
  readonly probe: GmailOperationalProbeResult;
  readonly hasRefreshToken: boolean;
  readonly grantedScopes: readonly string[];
  /** True when the probe succeeded AND a refresh token is persisted. */
  readonly operational: boolean;
  readonly returnPath?: string;
  readonly requestedToolId?: GoogleTokenProvider;
}

/**
 * Validate the OAuth state nonce (CSRF / replay / org mismatch).
 * Callers wire their own lookup + consume callbacks so the state
 * store remains an implementation detail (durable Supabase-backed in
 * production, in-memory in tests).
 */
export async function validateOAuthState(
  stateLookup: (
    nonce: string,
  ) => Promise<{
    organizationId: string;
    userId: string;
    returnPath?: string;
    requestedToolId?: GoogleTokenProvider;
    consumed?: boolean;
  } | null>,
  stateConsume: (nonce: string) => Promise<void>,
  input: { code: string; state: string; organizationId: string; userId: string },
): Promise<{ returnPath?: string; requestedToolId?: GoogleTokenProvider }> {
  const existing = await stateLookup(input.state);
  if (!existing) {
    const err = new Error("OAuth state missing or expired");
    (err as Error & { code?: string }).code = "invalid_state";
    throw err;
  }
  if (existing.consumed) {
    const err = new Error("OAuth state already used");
    (err as Error & { code?: string }).code = "replay";
    throw err;
  }
  if (existing.organizationId !== input.organizationId) {
    const err = new Error(
      "OAuth state does not belong to this organization",
    );
    (err as Error & { code?: string }).code = "org_mismatch";
    throw err;
  }
  await stateConsume(input.state);
  if (existing.userId !== input.userId) {
    const err = new Error("OAuth state does not belong to this user");
    (err as Error & { code?: string }).code = "user_mismatch";
    throw err;
  }
  return {
    ...(existing.returnPath ? { returnPath: existing.returnPath } : {}),
    ...(existing.requestedToolId ? { requestedToolId: existing.requestedToolId } : {}),
  };
}

/** Fetch Google's userinfo for a freshly exchanged access token. */
async function fetchGoogleIdentity(
  accessToken: string,
): Promise<{ email: string; displayName: string }> {
  const response = await googleApiFetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Google userinfo returned ${response.status}`);
  }
  const data = (await response.json()) as { email?: string; name?: string };
  return {
    email: (data.email ?? "").toLowerCase(),
    displayName: data.name ?? "",
  };
}

/**
 * Run the full Google OAuth callback pipeline.
 *
 * On success: returns the durable record, identity, granted scopes,
 * operational probe result, and the merged refresh token (existing
 * or new).
 *
 * Caller side-effects:
 *
 *   - Use `result.operational` to mark the connection. Never mark
 *     operational based purely on the OAuth HTTP 200.
 *   - Persist `result.record` to the durable store is done here —
 *     the route handler does not need to call `store.put` again.
 *   - Surface `result.grantedScopes` to the capability registry so
 *     email.search / email.send / etc. reflect what Google authorized.
 */
export async function completeGoogleOAuthCallback(
  input: CompleteGoogleOAuthInput,
): Promise<CompleteGoogleOAuthResult> {
  const checkpoint = (name: string, data: Record<string, unknown> = {}): void => {
    input.onCheckpoint?.(name, data);
  };

  const stateBinding = await validateOAuthState(
    input.stateNonceLookup,
    input.stateNonceConsume,
    input,
  );
  checkpoint("google_oauth_state_valid", { organizationId: input.organizationId });

  // 2. Code exchange (bounded — never hang the callback request).
  const tokenResponse = await googleApiFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!tokenResponse.ok) {
    // SAFE: only the HTTP status from Google; never the response body.
    checkpoint("google_oauth_token_exchange_failed", {
      httpStatus: tokenResponse.status,
      organizationId: input.organizationId,
    });
    throw new Error(
      `Google token exchange returned ${tokenResponse.status}`,
    );
  }
  const exchange = (await tokenResponse.json()) as TokenExchangeResponse;
  checkpoint("google_oauth_token_exchange_success", {
    organizationId: input.organizationId,
    hasAccessToken: Boolean(exchange.access_token),
    refreshTokenPresentInResponse: Boolean(exchange.refresh_token),
  });

  // 3. Identity fetch (gmail userinfo).
  if (!exchange.access_token) {
    throw new Error("Google token exchange missing access_token");
  }
  const identity = await fetchGoogleIdentity(exchange.access_token);
  if (!identity.email) {
    throw new Error("Google userinfo response missing email");
  }

  // 4. Merge with any existing persistent tokens — preserve
  // refresh_token + previous scopes when Google omits them.
  const store = getGoogleTokenStore();
  const previous = await store.get(input.organizationId, input.userId);
  checkpoint("google_oauth_existing_refresh_token_present", {
    existingRefreshTokenPresent: Boolean(previous?.refreshToken),
    organizationId: input.organizationId,
  });
  const nowMs = input.nowMs ?? Date.now();
  const merged = mergeTokenExchange({
    organizationId: input.organizationId,
    userId: input.userId,
    provider: input.provider,
    exchange,
    previousRefreshToken: previous?.refreshToken ?? null,
    previousScopes: previous?.scopes ?? [],
    email: identity.email,
    displayName: identity.displayName,
    nowMs,
  });
  checkpoint("google_oauth_granted_scopes", {
    scopes: merged.scopes,
    organizationId: input.organizationId,
  });
  checkpoint("google_oauth_refresh_token_present", {
    refreshTokenPresent: merged.hasRefreshToken,
    organizationId: input.organizationId,
  });

  // 5. Operational probe. We do this BEFORE persistence so a failure
  // here does not silently flip the connection to "operational".
  // A failed probe still persists the token; the connection card
  // surfaces a recovery action instead.
  const probe = await probeGoogleOperational(
    merged.accessToken,
    merged.scopes,
    input.probeFetcher,
    input.provider,
  );
  checkpoint(
    probe.operational
      ? "google_oauth_gmail_probe_success"
      : "google_oauth_gmail_probe_failed",
    { probeError: probe.error, organizationId: input.organizationId },
  );

  // 6. Build the durable record and persist.
  // A capability-specific re-consent must not erase previously verified
  // Gmail evidence. Older rows may not have operationalCapabilities yet;
  // infer only the safe read capability from the already-verified Gmail probe.
  const inheritedOperationalCapabilities = previous?.operationalCapabilities ?? (
    previous?.operationalVerifiedAt && hasGoogleCapability(previous.scopes, "email.read")
      ? ["email.read" as GoogleCapability]
      : []
  );
  const nextOperationalCapabilities = probe.operational
    ? Array.from(new Set([
        ...inheritedOperationalCapabilities,
        ...(input.provider === "gmail"
          ? ["email.read" as GoogleCapability]
          : input.provider === "google_calendar"
            ? ["calendar.read" as GoogleCapability]
            : input.provider === "google_drive" || input.provider === "google_workspace"
              ? ["drive.search" as GoogleCapability, "drive.read" as GoogleCapability]
              : []),
      ]))
    : inheritedOperationalCapabilities;
  const record: GoogleTokenRecord = {
    organizationId: input.organizationId,
    userId: input.userId,
    provider: "gmail",
    accessToken: merged.accessToken,
    refreshToken: merged.refreshToken,
    expiresAt: merged.expiresAt,
    scopes: merged.scopes,
    email: identity.email,
    displayName: identity.displayName,
    // A failed incremental probe must not demote a capability that was
    // already verified successfully. The callback still returns
    // operational=false for the newly requested capability.
    operationalVerifiedAt: probe.operational
      ? probe.verifiedAt
      : previous?.operationalVerifiedAt ?? null,
    operationalProbeError: probe.operational ? null : probe.error,
    ...(nextOperationalCapabilities.length > 0
      ? { operationalCapabilities: nextOperationalCapabilities }
      : {}),
  };
  await store.put(record);
  checkpoint("google_oauth_credential_persisted", {
    organizationId: input.organizationId,
    provider: input.provider,
  });

  // Write → read-back: never trust the insert alone. If the durable
  // store cannot return the row we just wrote, the connection must not
  // be presented as connected (persistence problem, not OAuth problem).
  let reloaded = false;
  try {
    const reread = await store.get(input.organizationId, input.userId);
    reloaded = Boolean(
      reread &&
        reread.organizationId === input.organizationId &&
        reread.userId === input.userId &&
        reread.provider === "gmail" &&
        reread.accessToken === merged.accessToken,
    );
  } catch {
    reloaded = false;
  }
  checkpoint("google_oauth_credential_reload_success", {
    reloaded,
    organizationId: input.organizationId,
  });
  if (!reloaded) {
    const err = new Error(
      "Google credential persisted but could not be read back",
    );
    (err as Error & { code?: string }).code =
      "credential_persisted_but_not_readable";
    throw err;
  }

  // Also write to the legacy in-memory store so test suites and
  // any existing adapter path that reads from `gmailTokenStore`
  // (the legacy singleton) keep working. The durable row is the
  // production source of truth; the in-memory entry is a dev /
  // tests fallback.
  gmailTokenStore.put(input.organizationId, input.userId, {
    accessToken: merged.accessToken,
    refreshToken: merged.refreshToken ?? "",
    expiresAt: merged.expiresAt,
    scopes: merged.scopes,
    email: identity.email,
    displayName: identity.displayName,
  });

  checkpoint(
    probe.operational && merged.hasRefreshToken
      ? "google_oauth_connection_marked_operational"
      : "google_oauth_connection_not_operational",
    { organizationId: input.organizationId, provider: input.provider },
  );

  return {
    record,
    identity: {
      email: identity.email,
      displayName: identity.displayName,
      provider: "gmail",
    },
    probe,
    hasRefreshToken: Boolean(merged.refreshToken),
    grantedScopes: merged.scopes,
    operational: probe.operational && Boolean(merged.refreshToken),
    ...(stateBinding.returnPath ? { returnPath: stateBinding.returnPath } : {}),
    ...(stateBinding.requestedToolId ? { requestedToolId: stateBinding.requestedToolId } : {}),
  };
}

/**
 * Determine whether the granted scopes cover a specific OAuth scope
 * URL. The granted scope set is the one Google actually returned in
 * the token response; capability availability is derived from this,
 * not from the requested set.
 */
export function hasGrantedScope(
  granted: readonly string[],
  scope: string,
): boolean {
  return granted.includes(scope);
}

/** Map the canonical Gmail capability → required OAuth scope URL. */
export const GMAIL_SCOPE_TO_CAPABILITY = {
  "https://www.googleapis.com/auth/userinfo.email":
    "email.identity.read",
  "https://www.googleapis.com/auth/userinfo.profile":
    "email.identity.read",
  "https://www.googleapis.com/auth/gmail.readonly": [
    "email.identity.read",
    "email.context.read",
    "email.search",
    "email.thread.read",
  ],
  "https://www.googleapis.com/auth/gmail.compose": ["email.draft"],
  "https://www.googleapis.com/auth/gmail.send": ["email.send.personal"],
} as const;

/**
 * Derive the operational Gmail capabilities from the granted OAuth
 * scopes. Used by the capability registry / chat pipeline.
 */
export function gmailCapabilitiesFromScopes(
  granted: readonly string[],
): ReadonlyArray<string> {
  const out = new Set<string>();
  for (const [scope, capabilities] of Object.entries(GMAIL_SCOPE_TO_CAPABILITY)) {
    if (granted.includes(scope)) {
      for (const cap of capabilities) out.add(cap);
    }
  }
  return Array.from(out);
}

export function hasGoogleCapability(
  scopes: readonly string[],
  capability: GoogleCapability,
): boolean {
  return GOOGLE_CAPABILITY_SCOPES[capability].every((scope) => scopes.includes(scope));
}

export function hasOperationalGoogleCapability(
  summary: Pick<GoogleTokenSummary, "hasRefreshToken" | "operationalVerifiedAt" | "scopes" | "operationalCapabilities">,
  capability: GoogleCapability,
): boolean {
  if (!summary.hasRefreshToken || !summary.operationalVerifiedAt) return false;
  if (!hasGoogleCapability(summary.scopes, capability)) return false;
  // Older durable rows only have a Gmail probe. Keep Gmail capabilities
  // compatible when their granted scopes were present; Calendar and Drive
  // still need explicit evidence from their own probe.
  return summary.operationalCapabilities
    ? summary.operationalCapabilities.includes(capability)
    : capability.startsWith("email.");
}

export function googleCapabilitiesFromScopes(
  scopes: readonly string[],
): readonly GoogleCapability[] {
  return (Object.keys(GOOGLE_CAPABILITY_SCOPES) as GoogleCapability[]).filter((capability) =>
    hasGoogleCapability(scopes, capability),
  );
}


export type { GmailTokens };

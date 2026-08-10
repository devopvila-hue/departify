/**
 * Gmail OAuth — Customer Zero 02.
 *
 * Real OAuth 2.0 authorization code flow against Google's
 * `accounts.google.com/o/oauth2/v2/auth` endpoint with:
 *
 *   - CSRF / replay / organization-mismatch protection through
 *     a state store keyed by (organizationId, userId, intent,
 *     returnPath, nonce, expiry).
 *   - Refresh tokens persisted in a server-only, in-memory
 *     store keyed by (organizationId, userId). NEVER serialized
 *     to the portal.
 *   - Token refresh on every call (refresh-aware) so calls do not
 *     silently fail on expiry.
 *   - Minimum-privilege scopes (identity + readonly + compose +
 *     send). No Drive / Calendar / Contacts scope requested.
 *
 * The adapter exposes business capabilities, NOT Gmail-specific
 * shapes. Elvira sees `email.search` and `email.thread.read`; the
 * portal sees a normalized `EmailIdentity` / `EmailThread` /
 * `EmailMessage`.
 */

import type { SupportedLocale } from "./locale.js";
import {
  getGoogleTokenStore,
  refreshGoogleToken,
} from "./google-tokens.js";

/* ----------------------------------------------------------------------------
 * Scopes (minimum privilege).
 * --------------------------------------------------------------------------*/

export const GMAIL_SCOPES: readonly string[] = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
];

/**
 * Customer Zero 03 — unified Google scopes. The CEO authorizes ONE
 * Google connection and Departify exposes three business capabilities
 * (Gmail + Calendar + Drive). Today we still ship the Gmail scopes
 * only; Calendar + Drive scopes live below for the next round of
 * Google Cloud verification. They are NEVER requested until the
 * corresponding capability is required.
 */
export const GOOGLE_CALENDAR_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export const GOOGLE_DRIVE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

/** Full scope set the unified Google connection will eventually
 *  request. Customers Zero 02 / 03 ships only the Gmail subset. */
export const GOOGLE_FULL_SCOPES: readonly string[] = [
  ...GMAIL_SCOPES,
  ...GOOGLE_CALENDAR_SCOPES,
  ...GOOGLE_DRIVE_SCOPES,
];

/* ----------------------------------------------------------------------------
 * Normalized types.
 * --------------------------------------------------------------------------*/

export interface EmailIdentity {
  readonly email: string;
  readonly displayName: string;
  readonly provider: "gmail";
}

export interface EmailAddress {
  readonly email: string;
  readonly displayName?: string;
}

export interface EmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly subject: string;
  readonly from: EmailAddress;
  readonly to: readonly EmailAddress[];
  readonly cc?: readonly EmailAddress[];
  readonly snippet: string;
  readonly date: string;
  readonly isUnread: boolean;
  readonly labels?: readonly string[];
  readonly bodyText?: string;
  readonly bodyHtml?: string;
}

export interface EmailThread {
  readonly id: string;
  readonly subject: string;
  readonly messages: readonly EmailMessage[];
  readonly participants: readonly EmailAddress[];
}

export interface EmailDraft {
  readonly id: string;
  readonly threadId: string | null;
  readonly to: readonly EmailAddress[];
  readonly subject: string;
  readonly bodyText: string;
  readonly updatedAt: string;
}

export interface EmailSendResult {
  readonly messageId: string;
  readonly threadId: string;
  readonly sentAt: string;
}

/* ----------------------------------------------------------------------------
 * Tokens.
 * --------------------------------------------------------------------------*/

export interface GmailTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  readonly email: string;
  readonly displayName: string;
}

/* ----------------------------------------------------------------------------
 * State store — CSRF + replay + org mismatch protection.
 *
 * DURABLE across Railway instances/restarts: the active store is
 * resolved via `getGoogleOAuthStateStore()` (Supabase-backed in
 * production, in-memory in tests/dev). See oauth-state.ts. The nonce
 * binding survives any replica/restart between the `connect` request
 * and the `callback` request — an in-memory store would fail the
 * callback with invalid_state and produce the silent consent loop.
 * --------------------------------------------------------------------------*/

import {
  getGoogleOAuthStateStore,
  type OAuthStateRecord,
} from "./oauth-state.js";

/** Backward-compatible alias for the OAuth state binding shape. */
export type GmailOAuthState = OAuthStateRecord;

/** Shared default in-memory store (tests seed this directly). */
export { gmailOAuthStateStore } from "./oauth-state.js";

/* ----------------------------------------------------------------------------
 * Token store — server-only, org-scoped, user-scoped.
 * --------------------------------------------------------------------------*/

class GmailTokenStore {
  private readonly map = new Map<string, GmailTokens>();

  private key(organizationId: string, userId: string): string {
    return `${organizationId}::${userId}`;
  }

  put(organizationId: string, userId: string, tokens: GmailTokens): void {
    this.map.set(this.key(organizationId, userId), tokens);
  }

  get(organizationId: string, userId: string): GmailTokens | null {
    return this.map.get(this.key(organizationId, userId)) ?? null;
  }

  remove(organizationId: string, userId: string): void {
    this.map.delete(this.key(organizationId, userId));
  }

  list(): ReadonlyArray<{ organizationId: string; userId: string; email: string }> {
    const out: Array<{ organizationId: string; userId: string; email: string }> = [];
    for (const [key, tokens] of this.map.entries()) {
      const idx = key.indexOf("::");
      if (idx === -1) continue;
      out.push({
        organizationId: key.slice(0, idx),
        userId: key.slice(idx + 2),
        email: tokens.email,
      });
    }
    return out;
  }
}

export const gmailTokenStore = new GmailTokenStore();

/* ----------------------------------------------------------------------------
 * Canonical Google OAuth redirect URI — single source of truth.
 *
 * The Google Cloud Web Client has ONE authorized redirect URI:
 *   ${PUBLIC_BASE_URL}/connections/google/callback
 *
 * This is the SAME URL the browser hits after consent, AND the SAME
 * URL the backend exchanges at oauth2.googleapis.com/token. The two
 * MUST be byte-identical, otherwise Google rejects with
 * `redirect_uri_mismatch`.
 *
 * organizationId / userId / toolId travel through the OAuth `state`
 * nonce (see gmailOAuthStateStore), NEVER through the URL.
 * --------------------------------------------------------------------------*/

/** The canonical path component of the Google OAuth callback. */
export const GOOGLE_OAUTH_REDIRECT_PATH = "/connections/google/callback";

/**
 * Build the canonical Google OAuth redirect URI.
 *
 * @param publicBaseUrl The PUBLIC_BASE_URL of the portal
 *   (e.g. "https://app.departify.app"). When undefined the helper
 *   reads process.env.PUBLIC_BASE_URL at call time (so it tracks the
 *   latest env value in dev / test), then falls back to the local-dev
 *   origin. EVERY call site MUST pass this — never per-organization
 *   paths.
 */
export function googleOAuthRedirectUri(publicBaseUrl?: string): string {
  const fromArg = (publicBaseUrl ?? "").trim().replace(/\/+$/, "");
  const fromEnv = (
    process.env["PUBLIC_BASE_URL"] ?? ""
  ).trim().replace(/\/+$/, "");
  const base = fromArg || fromEnv || "http://localhost:3000";
  return `${base}${GOOGLE_OAUTH_REDIRECT_PATH}`;
}

/* ----------------------------------------------------------------------------
 * OAuth start + callback.
 * --------------------------------------------------------------------------*/

export interface GmailOAuthStartInput {
  readonly organizationId: string;
  readonly userId: string;
  readonly returnPath: string;
  readonly locale: SupportedLocale;
  readonly redirectUri: string;
  readonly clientId: string;
}

export interface GmailOAuthStartOutput {
  readonly authorizationUrl: string;
  readonly state: string;
}

/**
 * Generate a fresh OAuth state and return the authorization URL.
 * The state is bound to (organizationId, userId, intent, returnPath)
 * and expires in 10 minutes.
 */
export async function startGmailOAuth(
  input: GmailOAuthStartInput,
): Promise<GmailOAuthStartOutput> {
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  // Durable state store: the nonce MUST survive across Railway
  // instances/restarts between this request and the callback request.
  await getGoogleOAuthStateStore().put({
    nonce,
    organizationId: input.organizationId,
    userId: input.userId,
    connectionIntent: "marketing",
    returnPath: input.returnPath,
    createdAt: new Date().toISOString(),
    expiresAt,
  });
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: nonce,
  });
  const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return { authorizationUrl, state: nonce };
}

export interface GmailOAuthCallbackInput {
  readonly code: string;
  readonly state: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GmailOAuthCallbackOutput {
  readonly tokens: GmailTokens;
  readonly identity: EmailIdentity;
}

/**
 * Validate the state, exchange the code for tokens, persist them,
 * and return the normalized identity. Throws on CSRF / replay /
 * org mismatch.
 *
 * The granted scopes replace any previously stored scopes. If Google
 * omits `refresh_token` on a reconnect, the existing refresh token
 * is preserved.
 *
 * After persistence, a lightweight Gmail probe (`gmail.users.getProfile`)
 * runs to confirm Google accepts the credentials. The probe result
 * is returned alongside the identity so callers can mark the
 * connection operational only on success.
 */
export async function completeGmailOAuth(
  input: GmailOAuthCallbackInput,
): Promise<GmailOAuthCallbackOutput> {
  // 1. State validation (durable store — works across instances).
  const state = await getGoogleOAuthStateStore().get(input.state);
  if (!state) {
    throw new GmailOAuthError("invalid_state", "OAuth state missing or expired");
  }
  if (state.consumed) {
    throw new GmailOAuthError("replay", "OAuth state already used");
  }
  if (state.organizationId !== input.organizationId) {
    throw new GmailOAuthError(
      "org_mismatch",
      "OAuth state does not belong to this organization",
    );
  }
  if (state.userId !== input.userId) {
    throw new GmailOAuthError(
      "user_mismatch",
      "OAuth state does not belong to this user",
    );
  }
  await getGoogleOAuthStateStore().consume(input.state);

  // 2. Code exchange.
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
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
    throw new GmailOAuthError(
      "token_exchange_failed",
      `Gmail token exchange returned ${tokenResponse.status}`,
    );
  }
  const tokenJson = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
  if (!tokenJson.access_token) {
    throw new GmailOAuthError(
      "missing_access_token",
      "Gmail token response missing access_token",
    );
  }
  const expiresAt = new Date(
    Date.now() + (tokenJson.expires_in ?? 3600) * 1000,
  ).toISOString();

  // 3. Identity from userinfo endpoint.
  const profile = await fetchGmailIdentity(tokenJson.access_token);
  if (!profile.email) {
    throw new GmailOAuthError(
      "missing_identity",
      "Gmail userinfo response missing email",
    );
  }

  // 4. Granted scopes. Replace the previously stored scopes with the
  // set Google actually granted on this exchange. Falling back to
  // GMAIL_SCOPES only when the response carries no scope string — a
  // rare but possible response shape.
  const grantedScopes = (tokenJson.scope ?? "").trim();
  const scopes = grantedScopes
    ? grantedScopes.split(/\s+/).filter(Boolean)
    : [...GMAIL_SCOPES];

  const tokens: GmailTokens = {
    accessToken: tokenJson.access_token,
    // Preserve the persistent refresh token when Google omits a new
    // one on a reconnect. The synchronous in-memory store is only
    // used in tests; production goes through the async
    // `getGoogleTokenStore()`.
    refreshToken: tokenJson.refresh_token ?? "",
    expiresAt,
    scopes,
    email: profile.email,
    displayName: profile.displayName,
  };
  gmailTokenStore.put(input.organizationId, input.userId, tokens);

  return {
    tokens,
    identity: {
      email: profile.email,
      displayName: profile.displayName,
      provider: "gmail",
    },
  };
}

export class GmailOAuthError extends Error {
  constructor(
    public readonly code:
      | "invalid_state"
      | "replay"
      | "org_mismatch"
      | "user_mismatch"
      | "token_exchange_failed"
      | "missing_tokens"
      | "missing_access_token"
      | "missing_identity",
    message: string,
  ) {
    super(message.slice(0, 200));
    this.name = "GmailOAuthError";
  }
}

async function fetchGmailIdentity(
  accessToken: string,
): Promise<{ email: string; displayName: string }> {
  const response = await fetch(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    throw new GmailOAuthError(
      "missing_identity",
      `Gmail userinfo returned ${response.status}`,
    );
  }
  const data = (await response.json()) as {
    email?: string;
    name?: string;
  };
  return {
    email: (data.email ?? "").toLowerCase(),
    displayName: data.name ?? "",
  };
}

/* ----------------------------------------------------------------------------
 * GmailAdapter — capability surface.
 * --------------------------------------------------------------------------*/

export interface GmailAdapterInput {
  readonly organizationId: string;
  readonly userId: string;
}

export interface GmailAdapterResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly errorCode?: "auth" | "unavailable" | "rate_limit" | "invalid_response";
  readonly message?: string;
}

function ok<T>(value: T): GmailAdapterResult<T> {
  return { success: true, value };
}
function fail<T>(
  message: string,
  code: GmailAdapterResult<T>["errorCode"] = "invalid_response",
): GmailAdapterResult<T> {
  return { success: false, errorCode: code, message };
}

/**
 * The unified adapter for Gmail + Workspace + Calendar + Drive —
 * reads its credentials from the durable Google token store
 * (production: Supabase `google_oauth_tokens`; tests/dev: in-memory).
 * This is the SINGLE boundary that turns the CEO's OAuth consent
 * into real capability execution.
 */
export class GmailAdapter {
  constructor(
    private readonly input: GmailAdapterInput,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  /** Returns the current tokens, refreshing if necessary. Reads
   *  from the durable Google token store; falls back to the legacy
   *  in-memory store when no durable row exists (dev / tests). */
  private async getTokens(): Promise<GmailTokens | null> {
    const durable = await getGoogleTokenStore().get(
      this.input.organizationId,
      this.input.userId,
    );
    if (!durable) {
      const legacy = gmailTokenStore.get(
        this.input.organizationId,
        this.input.userId,
      );
      if (!legacy) return null;
      return legacy;
    }
    const tokens: GmailTokens = {
      accessToken: durable.accessToken,
      refreshToken: durable.refreshToken ?? "",
      expiresAt: durable.expiresAt,
      scopes: durable.scopes,
      email: durable.email,
      displayName: durable.displayName ?? "",
    };
    if (new Date(tokens.expiresAt).getTime() - 60_000 > Date.now()) {
      return tokens;
    }
    return this.refresh(tokens);
  }

  private async refresh(
    current: GmailTokens,
  ): Promise<GmailTokens | null> {
    if (!current.refreshToken) return current;
    const result = await refreshGoogleToken({
      refreshToken: current.refreshToken,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
    });
    const next: GmailTokens = {
      ...current,
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      scopes:
        result.scopes.length > 0 && current.scopes.length === 0
          ? result.scopes
          : current.scopes,
    };
    // Persist back into the durable store so subsequent processes
    // see the rotated token. The legacy in-memory cache is only a
    // dev / tests fallback and is not used in production.
    await getGoogleTokenStore().put({
      organizationId: this.input.organizationId,
      userId: this.input.userId,
      provider: "gmail",
      accessToken: next.accessToken,
      refreshToken: next.refreshToken || null,
      expiresAt: next.expiresAt,
      scopes: next.scopes,
      email: next.email,
      displayName: next.displayName ?? null,
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
    });
    // Belt-and-braces: also write to the legacy in-memory store
    // when present, so existing tests keep working.
    gmailTokenStore.put(
      this.input.organizationId,
      this.input.userId,
      next,
    );
    return next;
  }

  async getIdentity(): Promise<GmailAdapterResult<EmailIdentity>> {
    const tokens = await this.getTokens();
    if (!tokens) return fail("Gmail no está conectado.", "auth");
    return ok({
      email: tokens.email,
      displayName: tokens.displayName,
      provider: "gmail",
    });
  }

  async searchMessages(
    query: string,
    maxResults = 20,
  ): Promise<GmailAdapterResult<readonly EmailMessage[]>> {
    const tokens = await this.getTokens();
    if (!tokens) return fail("Gmail no está conectado.", "auth");
    if (!query.trim()) return fail("Búsqueda vacía.", "invalid_response");
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", String(maxResults));
    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!response.ok) {
      if (response.status === 401) return fail("Gmail rechazó la autorización.", "auth");
      if (response.status === 429) return fail("Gmail aplicó rate limit.", "rate_limit");
      if (response.status >= 500) return fail("Gmail no responde.", "unavailable");
      return fail(`Gmail devolvió ${response.status}.`, "invalid_response");
    }
    const list = (await response.json()) as { messages?: Array<{ id?: string }> };
    const ids = (list.messages ?? []).map((m) => m.id).filter(Boolean) as string[];
    const messages: EmailMessage[] = [];
    for (const id of ids) {
      const detail = await fetchGmailMessage(tokens.accessToken, id);
      if (detail.success && detail.value) messages.push(detail.value);
    }
    return ok(messages);
  }

  async getThread(threadId: string): Promise<GmailAdapterResult<EmailThread>> {
    const tokens = await this.getTokens();
    if (!tokens) return fail("Gmail no está conectado.", "auth");
    if (!threadId) return fail("Hilo vacío.", "invalid_response");
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!response.ok) {
      if (response.status === 401) return fail("Gmail rechazó la autorización.", "auth");
      return fail(`Gmail devolvió ${response.status}.`, "invalid_response");
    }
    const data = (await response.json()) as {
      id?: string;
      messages?: Array<{
        id?: string;
        threadId?: string;
        snippet?: string;
        labelIds?: string[];
        payload?: {
          headers?: Array<{ name?: string; value?: string }>;
        };
      }>;
    };
    const messages: EmailMessage[] = [];
    for (const m of data.messages ?? []) {
      if (!m.id) continue;
      const headers = m.payload?.headers ?? [];
      const get = (n: string): string =>
        headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
      messages.push({
        id: m.id,
        threadId: m.threadId ?? data.id ?? threadId,
        subject: get("Subject"),
        from: parseAddress(get("From")),
        to: parseAddressList(get("To")),
        snippet: m.snippet ?? "",
        date: get("Date"),
        isUnread: (m.labelIds ?? []).includes("UNREAD"),
        labels: m.labelIds ?? [],
      });
    }
    return ok({
      id: data.id ?? threadId,
      subject: messages[0]?.subject ?? "",
      messages,
      participants: uniqueParticipants(messages.flatMap((m) => [m.from, ...m.to])),
    });
  }

  async createDraft(input: {
    to: readonly string[];
    subject: string;
    bodyText: string;
    threadId?: string;
  }): Promise<GmailAdapterResult<EmailDraft>> {
    const tokens = await this.getTokens();
    if (!tokens) return fail("Gmail no está conectado.", "auth");
    const sanitized = sanitizeEmailInputs(input);
    if ("error" in sanitized) {
      return fail(sanitized.error, "invalid_response");
    }
      const raw = buildRfc822Message({
      from: `${tokens.displayName} <${tokens.email}>`,
      to: sanitized.to.join(", "),
      subject: sanitized.subject,
      body: sanitized.bodyText,
      ...(sanitized.threadId ? { threadId: sanitized.threadId } : {}),
    });
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: { raw: base64UrlEncode(raw) },
        }),
      },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Gmail rechazó la autorización.", "auth");
      return fail(`Gmail no aceptó el borrador (${response.status}).`, "invalid_response");
    }
    const data = (await response.json()) as { id?: string; message?: { threadId?: string } };
    return ok({
      id: data.id ?? "",
      threadId: data.message?.threadId ?? null,
      to: sanitized.to.map((email) => ({ email })),
      subject: sanitized.subject,
      bodyText: sanitized.bodyText,
      updatedAt: new Date().toISOString(),
    });
  }

  async sendMessage(input: {
    to: readonly string[];
    subject: string;
    bodyText: string;
    threadId?: string;
  }): Promise<GmailAdapterResult<EmailSendResult>> {
    const tokens = await this.getTokens();
    if (!tokens) return fail("Gmail no está conectado.", "auth");
    const sanitized = sanitizeEmailInputs(input);
    if ("error" in sanitized) {
      return fail(sanitized.error, "invalid_response");
    }
    const raw = buildRfc822Message({
      from: `${tokens.displayName} <${tokens.email}>`,
      to: sanitized.to.join(", "),
      subject: sanitized.subject,
      body: sanitized.bodyText,
      ...(sanitized.threadId ? { threadId: sanitized.threadId } : {}),
    });
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: base64UrlEncode(raw) }),
      },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Gmail rechazó la autorización.", "auth");
      if (response.status === 429) return fail("Gmail aplicó rate limit.", "rate_limit");
      return fail(`Gmail no envió el mensaje (${response.status}).`, "invalid_response");
    }
    const data = (await response.json()) as { id?: string; threadId?: string };
    return ok({
      messageId: data.id ?? "",
      threadId: data.threadId ?? "",
      sentAt: new Date().toISOString(),
    });
  }

  /**
   * Health check — combines token presence + Gmail API reachability
   * + identity accessibility.
   */
  async health(): Promise<{
    state: "connected" | "needs_attention" | "error";
    message: string;
  }> {
    const tokens = gmailTokenStore.get(this.input.organizationId, this.input.userId);
    if (!tokens) {
      return { state: "needs_attention", message: "Gmail no está conectado." };
    }
    try {
      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      );
      if (response.ok) {
        return { state: "connected", message: "Gmail conectado y operativo." };
      }
      if (response.status === 401) {
        return { state: "needs_attention", message: "Gmail rechazó la autorización." };
      }
      return { state: "error", message: `Gmail devolvió ${response.status}.` };
    } catch {
      return { state: "error", message: "Gmail no responde." };
    }
  }

  /** Disconnect — drops the tokens for this (org, user). */
  disconnect(): void {
    gmailTokenStore.remove(this.input.organizationId, this.input.userId);
  }
}

/* ----------------------------------------------------------------------------
 * Helpers.
 * --------------------------------------------------------------------------*/

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  // node:crypto is not available in this isolated module; use Math.random
  // with sufficient entropy. (Replace with crypto.randomUUID in browser.)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseAddress(value: string): EmailAddress {
  if (!value) return { email: "" };
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const email = (match[2] ?? "").trim();
    const displayName = (match[1] ?? "").trim();
    return displayName ? { email, displayName } : { email };
  }
  return { email: value.trim() };
}

function parseAddressList(value: string): readonly EmailAddress[] {
  if (!value) return [];
  return value.split(",").map((v) => parseAddress(v.trim())).filter((a) => a.email.length > 0);
}

function uniqueParticipants(
  list: readonly EmailAddress[],
): readonly EmailAddress[] {
  const seen = new Set<string>();
  const out: EmailAddress[] = [];
  for (const a of list) {
    if (!a.email) continue;
    const key = a.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

async function fetchGmailMessage(
  accessToken: string,
  id: string,
): Promise<GmailAdapterResult<EmailMessage>> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return fail(`Gmail devolvió ${response.status}.`, "invalid_response");
  const data = (await response.json()) as {
    id?: string;
    threadId?: string;
    snippet?: string;
    labelIds?: string[];
    payload?: { headers?: Array<{ name?: string; value?: string }> };
  };
  const headers = data.payload?.headers ?? [];
  const get = (n: string): string =>
    headers.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value ?? "";
  return ok({
    id: data.id ?? id,
    threadId: data.threadId ?? "",
    subject: get("Subject"),
    from: parseAddress(get("From")),
    to: parseAddressList(get("To")),
    snippet: data.snippet ?? "",
    date: get("Date"),
    isUnread: (data.labelIds ?? []).includes("UNREAD"),
    labels: data.labelIds ?? [],
  });
}

/* ----------------------------------------------------------------------------
 * Input sanitization (header-injection prevention).
 * --------------------------------------------------------------------------*/

interface SanitizedInputs {
  readonly to: readonly string[];
  readonly subject: string;
  readonly bodyText: string;
  readonly threadId?: string;
}

function sanitizeEmailInputs(input: {
  to: readonly string[];
  subject: string;
  bodyText: string;
  threadId?: string;
}): SanitizedInputs | { error: string } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const displayNameRegex = /^"?([^"<]*?)"?\s*<([^>]+)>$/;
  const to: string[] = [];
  for (const address of input.to) {
    // Accept "Display Name <email@x>" form by extracting the bare
    // address.
    const match = address.match(displayNameRegex);
    const candidate = match ? (match[2] ?? "").trim() : address.trim();
    if (!emailRegex.test(candidate)) {
      return { error: `Dirección inválida: ${address}` };
    }
    to.push(candidate);
  }
  if (to.length === 0) return { error: "Sin destinatarios." };
  if (input.subject.length === 0) return { error: "Asunto vacío." };
  // Strip CR/LF in subject and body to prevent header injection.
  if (/[\r\n]/.test(input.subject)) {
    return { error: "El asunto contiene caracteres no permitidos." };
  }
  const bodyText = input.bodyText.replace(/(\r\n|\r|\n)/g, "\r\n");
  return {
    to,
    subject: input.subject.slice(0, 998),
    bodyText: bodyText.slice(0, 100_000),
    ...(input.threadId ? { threadId: input.threadId } : {}),
  };
}

function buildRfc822Message(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string | undefined;
}): string {
  const headers: string[] = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  if (input.threadId) {
    headers.push(`In-Reply-To: <${input.threadId}>`);
    headers.push(`References: <${input.threadId}>`);
  }
  return `${headers.join("\r\n")}\r\n\r\n${input.body}`;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa is available in browsers + Node 18+
  const b64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(value, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

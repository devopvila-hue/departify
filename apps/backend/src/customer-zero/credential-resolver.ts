/**
 * CredentialResolver — Customer Zero 01.
 *
 * The ONLY authorized boundary that resolves external integration
 * credentials. It returns a typed handle that other code passes into
 * the adapter — it never returns the raw secret to the portal, never
 * serializes a secret outside its internal boundary, and never lets
 * the LLM inspect arbitrary environment.
 *
 * Sources today:
 *
 *   - Mautic     — environment variables (Customer Zero bootstrap).
 *   - Resend     — environment variable.
 *   - Gmail / Google Workspace / Calendar / Drive — durable Supabase-
 *                 backed `google_oauth_tokens` table (production) or
 *                 an in-memory map (tests / dev).
 *
 * Contract:
 *
 *   resolveCredentials({ organizationId, provider, userId })
 *     → { available, source, credentialHandle }
 *
 *   getCredentials({ handle })  // internal-only; never returned to portal
 *
 * The `handle` is an opaque token; no caller can use it to extract
 * the secret without going through the internal `getCredentials`
 * boundary. This keeps secrets out of logs, API responses, and the
 * model context.
 */

import { getGoogleTokenStore, type GoogleTokenSummary } from "./google-tokens.js";

export type CredentialProvider = "mautic" | "gmail" | "resend" | "google";

export interface CredentialSource {
  /** Where the credential ultimately comes from. */
  readonly source: "environment" | "secure_store" | "none";
  /** A human-readable, NON-SECRET label (e.g. "env:mautic"). */
  readonly label: string;
}

export interface CredentialHandle {
  /** Opaque, internal-only token. NEVER serialize. */
  readonly id: string;
  readonly provider: CredentialProvider;
  readonly source: CredentialSource["source"];
  /** Timestamp the credential was resolved. */
  readonly resolvedAt: string;
}

export interface CredentialResolution {
  readonly available: boolean;
  readonly source: CredentialSource["source"];
  readonly label: string;
  readonly handle?: CredentialHandle;
}

export interface CredentialResolutionInput {
  readonly organizationId: string;
  readonly provider: CredentialProvider;
  readonly userId?: string;
}

/** Internal-only resolved credential. NEVER returned to the portal. */
export type ResolvedCredential =
  | {
      readonly provider: "mautic";
      readonly baseUrl: string;
      readonly clientId: string;
      readonly clientSecret: string;
    }
  | {
      readonly provider: "gmail";
      readonly accessToken: string;
      readonly refreshToken: string | null;
      readonly expiresAt: string;
      readonly email: string;
      readonly displayName: string | null;
      readonly scopes: readonly string[];
      readonly operational: boolean;
    }
  | {
      readonly provider: "resend";
      readonly apiKey: string;
    };

function handleId(
  provider: CredentialProvider,
  source: CredentialSource["source"],
): string {
  return `${provider}:${source}:${Date.now().toString(36)}`;
}

const handleRegistry = new Map<string, ResolvedCredential>();

export function resolveCredentials(
  input: CredentialResolutionInput,
): CredentialResolution {
  if (input.provider === "mautic") {
    return resolveMauticFromEnv();
  }
  if (input.provider === "resend") {
    return resolveResendFromEnv();
  }
  // Gmail / Google — see `resolveGoogleCredentials` (async).
  return {
    available: false,
    source: "none",
    label: `${input.provider}:use_resolveGoogleCredentials`,
  };
}

/**
 * Resolve Google credentials against the durable token store. The
 * async boundary because the Supabase adapter is itself async.
 *
 * Calls that need a Google credential MUST await this function and
 * use the returned handle to fetch the access + refresh tokens.
 */
export async function resolveGoogleCredentials(
  input: CredentialResolutionInput,
): Promise<CredentialResolution> {
  const userId = input.userId ?? "system";
  const record = await getGoogleTokenStore().get(input.organizationId, userId);
  if (!record) {
    return {
      available: false,
      source: "none",
      label: `${input.provider}:oauth_required`,
    };
  }
  if (!record.refreshToken) {
    return {
      available: false,
      source: "secure_store",
      label: `${input.provider}:reauthorization_required`,
    };
  }
  const id = handleId(input.provider, "secure_store");
  handleRegistry.set(id, {
    provider: "gmail",
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    expiresAt: record.expiresAt,
    email: record.email,
    displayName: record.displayName,
    scopes: record.scopes,
    operational: Boolean(record.operationalVerifiedAt),
  });
  return {
    available: true,
    source: "secure_store",
    label: "secure_store:google",
    handle: {
      id,
      provider: input.provider,
      source: "secure_store",
      resolvedAt: new Date().toISOString(),
    },
  };
}

function resolveMauticFromEnv(): CredentialResolution {
  const baseUrl = (process.env["MAUTIC_BASE_URL"] ?? "")
    .trim()
    .replace(/\/$/, "");
  const clientId = (process.env["MAUTIC_CLIENT_ID"] ?? "").trim();
  const clientSecret = (process.env["MAUTIC_CLIENT_SECRET"] ?? "").trim();

  if (!baseUrl || !clientId || !clientSecret) {
    return {
      available: false,
      source: "none",
      label: "mautic:missing",
    };
  }

  const id = handleId("mautic", "environment");
  handleRegistry.set(id, {
    provider: "mautic",
    baseUrl,
    clientId,
    clientSecret,
  });
  return {
    available: true,
    source: "environment",
    label: "env:mautic",
    handle: {
      id,
      provider: "mautic",
      source: "environment",
      resolvedAt: new Date().toISOString(),
    },
  };
}

function resolveResendFromEnv(): CredentialResolution {
  const apiKey = (process.env["RESEND_API_KEY"] ?? "").trim();
  if (!apiKey) {
    return {
      available: false,
      source: "none",
      label: "resend:missing",
    };
  }
  const id = handleId("resend", "environment");
  handleRegistry.set(id, {
    provider: "resend",
    apiKey,
  });
  return {
    available: true,
    source: "environment",
    label: "env:resend",
    handle: {
      id,
      provider: "resend",
      source: "environment",
      resolvedAt: new Date().toISOString(),
    },
  };
}

export function getCredentials(handle: CredentialHandle): ResolvedCredential | null {
  return handleRegistry.get(handle.id) ?? null;
}

export function forgetCredential(handle: CredentialHandle): void {
  handleRegistry.delete(handle.id);
}

/**
 * True when the durable Gmail / Google token store currently holds a
 * refresh token for this org+user. Independent of probe state.
 */
export async function hasGmailStoredToken(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const record = await getGoogleTokenStore().get(organizationId, userId);
  if (!record) return false;
  return Boolean(record.refreshToken);
}

/**
 * True when the durable Gmail / Google token store currently holds an
 * operationally probed refresh token for this org+user.
 */
export async function hasOperationalGoogleIdentity(
  organizationId: string,
  userId: string,
): Promise<boolean> {
  const record = await getGoogleTokenStore().get(organizationId, userId);
  if (!record) return false;
  if (!record.refreshToken) return false;
  return Boolean(record.operationalVerifiedAt);
}

/**
 * True when ANY operationally probed refresh token exists for the org.
 * The /conexiones surface and the chat pipeline call this so they
 * never contradict each other.
 */
export async function hasOperationalGoogleIdentityForOrg(
  organizationId: string,
): Promise<boolean> {
  const summaries = await getGoogleTokenStore().listForOrg(organizationId);
  for (const s of summaries) {
    if (s.hasRefreshToken && s.operationalVerifiedAt) return true;
  }
  return false;
}

/** True when the org has at least one persisted Google token row. */
export async function hasAnyGoogleTokenForOrg(
  organizationId: string,
): Promise<boolean> {
  const summaries = await getGoogleTokenStore().listForOrg(organizationId);
  return summaries.some((s) => s.hasRefreshToken);
}

/**
 * Return the public-safe summary of the persisted Google token for a
 * given (org, user). Returns null when no durable token row exists.
 *
 * The summary NEVER contains the token values themselves. Used by
 * `/conexiones` and the central chat capability surface.
 */
export async function googleTokenSummaryFor(
  organizationId: string,
  userId: string,
): Promise<GoogleTokenSummary | null> {
  const record = await getGoogleTokenStore().get(organizationId, userId);
  if (!record) return null;
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
  };
}

/** Keep the legacy sync helper so existing tests still compile.
 *  Production code MUST call `resolveCredentials` (async). */
export function hasConfiguredCredentials(provider: CredentialProvider): boolean {
  // Best-effort, sync-only fallback used by hot paths that haven't
  // been updated yet. Returns the env-side answer for mautic/resend
  // and `false` for gmail (the durable store must be awaited for
  // an honest answer).
  if (provider === "mautic") {
    return Boolean(
      (process.env["MAUTIC_BASE_URL"] ?? "").trim() &&
        (process.env["MAUTIC_CLIENT_ID"] ?? "").trim() &&
        (process.env["MAUTIC_CLIENT_SECRET"] ?? "").trim(),
    );
  }
  if (provider === "resend") {
    return Boolean((process.env["RESEND_API_KEY"] ?? "").trim());
  }
  return false;
}

/**
 * Public-safe description of the configuration source. Never returns
 * the secret value. Suitable for the `/conexiones` UI ("Conectado
 * mediante configuración del sistema").
 */
export function publicCredentialSource(input: {
  organizationId: string;
  provider: CredentialProvider;
}): { available: boolean; label: string; source: CredentialSource["source"] } {
  // sync best-effort (matches old behaviour for callers that cannot
  // be made async cheaply).
  if (input.provider === "mautic" || input.provider === "resend") {
    const r =
      input.provider === "mautic"
        ? resolveMauticFromEnv()
        : resolveResendFromEnv();
    return { available: r.available, label: r.label, source: r.source };
  }
  return { available: false, label: `${input.provider}:oauth_required`, source: "none" };
}

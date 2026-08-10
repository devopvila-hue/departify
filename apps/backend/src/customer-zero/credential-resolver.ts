/**
 * CredentialResolver — Customer Zero 01.
 *
 * The ONLY authorized boundary that resolves external integration
 * credentials (Mautic today). It returns a typed handle that other
 * code passes into the adapter — it never returns the raw secret to
 * the portal, never serializes a secret outside its internal
 * boundary, and never lets the LLM inspect arbitrary environment.
 *
 * Today the only source is the backend environment variables
 * (Customer Zero bootstrap). The resolver is shaped so a future
 * Supabase encrypted store can replace the implementation without
 * callers changing.
 *
 * Contract:
 *
 *   resolveCredentials({ organizationId, provider })
 *     → { available, source, credentialHandle }
 *
 *   getCredentials({ handle })  // internal-only; never returned to portal
 *
 * The `handle` is an opaque token; no caller can use it to extract
 * the secret without going through the internal `getCredentials`
 * boundary. This keeps secrets out of logs, API responses, and the
 * model context.
 */

export type CredentialProvider = "mautic" | "gmail" | "resend";

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
}

/** Internal-only resolved credential. NEVER returned to the portal. */
export interface ResolvedCredential {
  readonly provider: CredentialProvider;
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Build a stable, opaque handle id from the source. The id never
 * encodes the secret value — only the source pointer — so the handle
 * itself is safe to log at debug level.
 */
function handleId(provider: CredentialProvider, source: CredentialSource["source"]): string {
  return `${provider}:${source}:${Date.now().toString(36)}`;
}

/** Internal registry of resolved credentials keyed by handle id. */
const handleRegistry = new Map<string, ResolvedCredential>();

/**
 * Resolve credentials for a provider. Returns availability + handle.
 * If `available: false`, no handle is returned and the caller can
 * surface a "Needs attention" state.
 */
export function resolveCredentials(
  input: CredentialResolutionInput,
): CredentialResolution {
  if (input.provider === "mautic") {
    return resolveMauticFromEnv();
  }
  if (input.provider === "resend") {
    return resolveResendFromEnv();
  }
  // gmail: tokens come from the durable per-org token store, not env.
  // Today that store is not implemented; the resolver returns
  // available=false so callers surface the OAuth connect flow.
  return { available: false, source: "none", label: `${input.provider}:oauth_required` };
}

function resolveMauticFromEnv(): CredentialResolution {
  const baseUrl = (process.env["MAUTIC_BASE_URL"] ?? "").trim().replace(/\/$/, "");
  const clientId = (process.env["MAUTIC_CLIENT_ID"] ?? "").trim();
  const clientSecret = (process.env["MAUTIC_CLIENT_SECRET"] ?? "").trim();

  if (!baseUrl || !clientId || !clientSecret) {
    return {
      available: false,
      source: "none",
      label: `mautic:missing`,
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
    baseUrl: "https://api.resend.com",
    clientId: "resend",
    clientSecret: apiKey,
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

/**
 * Internal-only accessor. Returns the actual credential for use by
 * adapter code. NEVER call from request handlers, never serialize the
 * return value, never log it.
 *
 * The audit log records only the handle id and the operation, never
 * the credential value.
 */
export function getCredentials(handle: CredentialHandle): ResolvedCredential | null {
  return handleRegistry.get(handle.id) ?? null;
}

/**
 * Drop a credential handle from the in-process registry. Useful for
 * tests and for forced re-resolution when env rotates.
 */
export function forgetCredential(handle: CredentialHandle): void {
  handleRegistry.delete(handle.id);
}

/** True when at least one source has credentials for a provider. */
export function hasConfiguredCredentials(provider: CredentialProvider): boolean {
  return resolveCredentials({ organizationId: "system", provider }).available;
}

/**
 * Public-safe description of the configuration source. Never returns
 * the secret value. Suitable for the `/conexiones` UI ("Conectado
 * mediante configuración del sistema").
 */
export function publicCredentialSource(
  input: CredentialResolutionInput,
): { available: boolean; label: string; source: CredentialSource["source"] } {
  const r = resolveCredentials(input);
  return {
    available: r.available,
    label: r.label,
    source: r.source,
  };
}

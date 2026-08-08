/**
 * Mautic Adapter — Sprint 61.
 *
 * Thin HTTP client for the Mautic Marketing Automation API. This adapter
 * is the ONLY place in the codebase authorized to make Mautic-specific HTTP
 * calls. It produces normalized, structured results and never exposes raw
 * credentials or API payloads beyond its boundary.
 *
 * Authentication: OAuth2 client_credentials (Mautic's documented flow).
 * The adapter receives resolved credentials at call time — it does NOT
 * read environment variables, access the config package, or hold state.
 */

export interface MauticCredentials {
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface MauticConnectionResult {
  readonly success: boolean;
  readonly message: string;
  readonly serverInfo?: { version: string; name: string };
}

export interface MauticContactCountResult {
  readonly success: boolean;
  readonly count: number;
  readonly message?: string;
}

export interface MauticContactSearchResult {
  readonly success: boolean;
  readonly count: number;
  readonly contacts: readonly MauticContact[];
  readonly message?: string;
}

export interface MauticContact {
  readonly id: number;
  readonly firstname: string;
  readonly lastname: string;
  readonly email: string;
}

async function requestToken(
  creds: MauticCredentials,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL("/oauth/v2/token", creds.baseUrl);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal,
  });

  if (!response.ok) {
    throw new MauticAuthError(
      response.status,
      await response.text().catch(() => ""),
    );
  }

  const data = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (data.error) {
    throw new MauticAuthError(
      401,
      data.error_description ?? data.error ?? "Unknown auth error",
    );
  }

  if (!data.access_token) {
    throw new MauticAuthError(401, "No access token in response");
  }

  return data.access_token;
}

async function mauticGet<T>(
  creds: MauticCredentials,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  const token = await requestToken(creds, signal);
  const url = new URL(path, creds.baseUrl);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new MauticApiError(response.status, text);
  }

  const data = (await response.json()) as T;
  return data;
}

export async function testMauticConnection(
  creds: MauticCredentials,
  signal: AbortSignal,
): Promise<MauticConnectionResult> {
  try {
    const token = await requestToken(creds, signal);
    // Once authenticated, fetch the API info to confirm the server is real.
    const response = await fetch(
      new URL("/api/info", creds.baseUrl).toString(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal,
      },
    );

    if (!response.ok) {
      return {
        success: false,
        message: `Mautic server responded with status ${response.status}. Verify your base URL.`,
      };
    }

    const info = (await response.json()) as {
      version?: string;
      name?: string;
    };

    return {
      success: true,
      message: `Connected to Mautic ${info.version ?? "unknown version"}.`,
      serverInfo: {
        version: info.version ?? "unknown",
        name: info.name ?? "Mautic",
      },
    };
  } catch (cause) {
    if (signal.aborted) {
      return { success: false, message: "Connection test timed out." };
    }
    if (cause instanceof MauticAuthError) {
      return {
        success: false,
        message: `Authentication failed: ${cause.message}`,
      };
    }
    return {
      success: false,
      message:
        cause instanceof Error
          ? cause.message
          : "Could not reach Mautic server.",
    };
  }
}

export async function getMauticContactCount(
  creds: MauticCredentials,
  signal: AbortSignal,
): Promise<MauticContactCountResult> {
  try {
    const data = await mauticGet<{ total?: number }>(
      creds,
      "/api/contacts?limit=1",
      signal,
    );
    return {
      success: true,
      count: data.total ?? 0,
    };
  } catch (cause) {
    if (signal.aborted) {
      return { success: false, count: 0, message: "Contact query timed out." };
    }
    return {
      success: false,
      count: 0,
      message:
        cause instanceof MauticApiError
          ? `Mautic API error: ${cause.message}`
          : `Could not query contacts: ${cause instanceof Error ? cause.message : "Unknown error"}`,
    };
  }
}

export async function searchMauticContacts(
  creds: MauticCredentials,
  query: string,
  signal: AbortSignal,
): Promise<MauticContactSearchResult> {
  try {
    const params = new URLSearchParams({ search: query, limit: "10" });
    const data = await mauticGet<{
      total?: number;
      contacts?: Record<
        string,
        {
          id: number;
          fields: { all: Record<string, unknown> };
        }
      >;
    }>(
      creds,
      `/api/contacts?${params.toString()}`,
      signal,
    );

    const contactEntries = Object.values(data.contacts ?? {});
    const contacts: MauticContact[] = contactEntries.map((c) => ({
      id: c.id,
      firstname: String(c.fields.all.firstname ?? ""),
      lastname: String(c.fields.all.lastname ?? ""),
      email: String(c.fields.all.email ?? ""),
    }));

    return {
      success: true,
      count: data.total ?? contacts.length,
      contacts,
    };
  } catch (cause) {
    if (signal.aborted) {
      return { success: false, count: 0, contacts: [], message: "Search timed out." };
    }
    return {
      success: false,
      count: 0,
      contacts: [],
      message:
        cause instanceof Error ? cause.message : "Search failed.",
    };
  }
}

export function resolveMauticCredentials(): MauticCredentials | null {
  const baseUrl = (process.env["MAUTIC_BASE_URL"] ?? "").trim().replace(
    /\/$/,
    "",
  );
  const clientId = (process.env["MAUTIC_CLIENT_ID"] ?? "").trim();
  const clientSecret = (process.env["MAUTIC_CLIENT_SECRET"] ?? "").trim();

  if (!baseUrl || !clientId || !clientSecret) {
    return null;
  }

  return { baseUrl, clientId, clientSecret };
}

export class MauticAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message.slice(0, 200));
    this.name = "MauticAuthError";
  }
}

export class MauticApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message.slice(0, 200));
    this.name = "MauticApiError";
  }
}

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

/**
 * The Tool Runtime passes a duck-typed cancellation handle
 * (`{ aborted, onAbort }`) as the executor signal (Sprint 20 sandbox
 * abstraction), which Node's `fetch` rejects because it requires a real
 * `AbortSignal` instance. Bridge the handle into a native `AbortSignal`
 * while preserving cancellation semantics.
 */
function toNativeAbortSignal(signal: AbortSignal): AbortSignal {
  if (signal instanceof AbortSignal) {
    return signal;
  }
  const controller = new AbortController();
  const handle = signal as unknown as {
    readonly aborted?: boolean;
    readonly onAbort?: (listener: (reason: string) => void) => void;
  };
  if (handle.aborted) {
    controller.abort();
  } else {
    handle.onAbort?.(() => controller.abort());
  }
  return controller.signal;
}

async function requestToken(
  creds: MauticCredentials,
  signal: AbortSignal,
): Promise<string> {
  signal = toNativeAbortSignal(signal);
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
  signal = toNativeAbortSignal(signal);
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
  signal = toNativeAbortSignal(signal);
  try {
    const token = await requestToken(creds, signal);
    // Once authenticated, fetch the current user to confirm the server is
    // real and the token is usable. Some Mautic installations do not expose
    // `/api/info`, so the authenticated user endpoint is the reliable
    // liveness check across deployments.
    const response = await fetch(
      new URL("/api/users/self", creds.baseUrl).toString(),
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

    const data = (await response.json()) as {
      user?: { id?: number; username?: string };
    };

    return {
      success: true,
      message: "Connected to Mautic.",
      serverInfo: {
        version: "unknown",
        name: data.user?.username ?? "Mautic",
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

/**
 * Customer Zero 01 — read-only adapter extensions.
 *
 * The Customer Zero 01 brief calls for richer Mautic reads with
 * normalized Departify-owned types (`CRMContact`, `CRMSegment`, …).
 * These functions wrap Mautic's REST API, never scrape, and never
 * invent fields. When Mautic returns an unexpected shape the result
 * is the safe empty value.
 */
import type {
  CRMActivity,
  CRMCampaign,
  CRMContact,
  CRMContactPage,
  CRMSegment,
  CRMSummary,
} from "./mautic-types.js";

export type {
  CRMActivity,
  CRMCampaign,
  CRMContact,
  CRMContactPage,
  CRMSegment,
  CRMSummary,
} from "./mautic-types.js";

/** Adapter result envelope — never throws to the caller. */
export interface MauticResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly errorCode?:
    | "auth"
    | "timeout"
    | "unavailable"
    | "rate_limit"
    | "invalid_response";
  readonly message?: string;
}

export interface MauticListContactsInput {
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: string;
}

function ok<T>(value: T): MauticResult<T> {
  return { success: true, value };
}

function fail<T>(
  message: string,
  code: MauticResult<T>["errorCode"] = "invalid_response",
): MauticResult<T> {
  return { success: false, errorCode: code, message };
}

function classifyError(cause: unknown): {
  message: string;
  code: MauticResult<unknown>["errorCode"];
} {
  if (cause instanceof MauticAuthError) {
    return {
      message: "Mautic rejected the credentials.",
      code: "auth",
    };
  }
  if (cause instanceof MauticApiError) {
    if (cause.status === 429) {
      return { message: "Mautic rate-limited the request.", code: "rate_limit" };
    }
    if (cause.status >= 500) {
      return { message: "Mautic is unavailable.", code: "unavailable" };
    }
    return {
      message: `Mautic returned ${cause.status}.`,
      code: "invalid_response",
    };
  }
  if (cause instanceof Error && cause.name === "AbortError") {
    return { message: "Mautic request timed out.", code: "timeout" };
  }
  return {
    message: cause instanceof Error ? cause.message : "Unknown Mautic error.",
    code: "unavailable",
  };
}

interface MauticRawContact {
  readonly id: number;
  readonly fields?: {
    readonly all?: Record<string, unknown>;
    readonly core?: Record<string, unknown>;
  };
  readonly dateAdded?: string;
  readonly lastActive?: string;
  readonly points?: number;
  readonly tags?: readonly { tag?: string }[] | readonly string[];
}

function normalizeContact(raw: MauticRawContact): CRMContact {
  const all = raw.fields?.all ?? {};
  const firstname = typeof all["firstname"] === "string" ? (all["firstname"] as string) : "";
  const lastname = typeof all["lastname"] === "string" ? (all["lastname"] as string) : "";
  const displayName = [firstname, lastname].filter((p) => p.length > 0).join(" ").trim() ||
    `Contacto #${raw.id}`;
  const email = typeof all["email"] === "string" ? (all["email"] as string).toLowerCase() : undefined;
  const company = typeof all["company"] === "string" ? (all["company"] as string) : undefined;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .map((t) => (typeof t === "string" ? t : t?.tag))
        .filter((t): t is string => typeof t === "string")
    : undefined;
  return {
    id: raw.id,
    displayName,
    ...(email ? { email } : {}),
    ...(company ? { company } : {}),
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(typeof raw.dateAdded === "string" ? { createdAt: raw.dateAdded } : {}),
    ...(typeof raw.lastActive === "string" ? { lastActivityAt: raw.lastActive } : {}),
    ...(typeof raw.points === "number" ? { score: raw.points } : {}),
  };
}

interface MauticRawSegment {
  readonly id: number;
  readonly name?: string;
  readonly description?: string;
  readonly leadCount?: number;
}

function normalizeSegment(raw: MauticRawSegment): CRMSegment {
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : `Segmento #${raw.id}`,
    ...(typeof raw.description === "string" && raw.description.length > 0
      ? { description: raw.description }
      : {}),
    ...(typeof raw.leadCount === "number" ? { contactCount: raw.leadCount } : {}),
  };
}

interface MauticRawCampaign {
  readonly id: number;
  readonly name?: string;
  readonly description?: string;
  readonly isPublished?: boolean;
  readonly publishStatus?: number;
}

function normalizeCampaign(raw: MauticRawCampaign): CRMCampaign {
  const status =
    raw.publishStatus === 1 || raw.isPublished === true
      ? "published"
      : raw.publishStatus === 0
        ? "unpublished"
        : undefined;
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : `Campaña #${raw.id}`,
    ...(typeof raw.description === "string" && raw.description.length > 0
      ? { description: raw.description }
      : {}),
    ...(typeof raw.isPublished === "boolean" ? { isPublished: raw.isPublished } : {}),
    ...(status ? { status } : {}),
  };
}

/** Paginated read of contacts. */
export async function listMauticContacts(
  creds: MauticCredentials,
  input: MauticListContactsInput = {},
  signal: AbortSignal,
): Promise<MauticResult<CRMContactPage>> {
  try {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);
    const params = new URLSearchParams({
      limit: String(limit),
      start: String(offset),
      ...(input.orderBy ? { orderBy: input.orderBy } : {}),
    });
    const data = await mauticGet<{
      total?: number;
      contacts?: Record<string, MauticRawContact>;
    }>(creds, `/api/contacts?${params.toString()}`, signal);
    const raw = Object.values(data.contacts ?? {});
    const contacts = raw.map(normalizeContact);
    const nextOffset =
      typeof data.total === "number" && offset + contacts.length < data.total
        ? offset + contacts.length
        : undefined;
    return ok({
      total: data.total ?? contacts.length,
      contacts,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
    });
  } catch (cause) {
    const { message, code } = classifyError(cause);
    if (signal.aborted) return fail("Mautic request timed out.", "timeout");
    return fail(message, code);
  }
}

/** Fetch a single contact by id. */
export async function getMauticContact(
  creds: MauticCredentials,
  contactId: number,
  signal: AbortSignal,
): Promise<MauticResult<CRMContact>> {
  try {
    const data = await mauticGet<{ contact?: MauticRawContact }>(
      creds,
      `/api/contacts/${encodeURIComponent(String(contactId))}`,
      signal,
    );
    const raw = data.contact;
    if (!raw) return fail(`Mautic contact ${contactId} not found.`, "invalid_response");
    return ok(normalizeContact(raw));
  } catch (cause) {
    const { message, code } = classifyError(cause);
    return fail(message, code);
  }
}

/** List all segments. */
export async function listMauticSegments(
  creds: MauticCredentials,
  signal: AbortSignal,
): Promise<MauticResult<readonly CRMSegment[]>> {
  try {
    const data = await mauticGet<{
      lists?: Record<string, MauticRawSegment>;
    }>(creds, "/api/segments?limit=200", signal);
    const segments = Object.values(data.lists ?? {}).map(normalizeSegment);
    return ok(segments);
  } catch (cause) {
    const { message, code } = classifyError(cause);
    return fail(message, code);
  }
}

/** List campaigns. */
export async function listMauticCampaigns(
  creds: MauticCredentials,
  signal: AbortSignal,
): Promise<MauticResult<readonly CRMCampaign[]>> {
  try {
    const data = await mauticGet<{
      campaigns?: Record<string, MauticRawCampaign>;
    }>(creds, "/api/campaigns?limit=200", signal);
    const campaigns = Object.values(data.campaigns ?? {}).map(normalizeCampaign);
    return ok(campaigns);
  } catch (cause) {
    const { message, code } = classifyError(cause);
    return fail(message, code);
  }
}

/** Activity for a contact — Mautic's events endpoint, when exposed. */
export async function getMauticContactActivity(
  creds: MauticCredentials,
  contactId: number,
  signal: AbortSignal,
): Promise<MauticResult<readonly CRMActivity[]>> {
  try {
    const data = await mauticGet<{
      events?: Array<{
        id?: number;
        eventType?: string;
        eventName?: string;
        dateAdded?: string;
        description?: string;
      }>;
    }>(
      creds,
      `/api/contacts/${encodeURIComponent(String(contactId))}/activity`,
      signal,
    );
    const activities: CRMActivity[] = (data.events ?? [])
      .filter((e) => typeof e.id === "number")
      .map((e) => ({
        id: e.id as number,
        contactId,
        type: typeof e.eventType === "string" ? e.eventType : "unknown",
        name: typeof e.eventName === "string" ? e.eventName : "Actividad",
        timestamp: typeof e.dateAdded === "string" ? e.dateAdded : "",
        ...(typeof e.description === "string" && e.description.length > 0
          ? { details: e.description }
          : {}),
      }));
    return ok(activities);
  } catch (cause) {
    // Some Mautic instances do not expose per-contact activity; degrade
    // gracefully so the UI can show "actividad no disponible".
    const { code } = classifyError(cause);
    if (code === "auth" || code === "unavailable") {
      return fail("Mautic activity is not available right now.", code);
    }
    return ok([] as readonly CRMActivity[]);
  }
}

/**
 * Aggregate summary used by Elvira's "look at our contacts" prompts.
 *
 * Calls the count + first page of contacts in parallel and then
 * derives simple aggregates in-memory. Returns normalized counts —
 * never raw numbers from Mautic without normalization.
 */
export async function getMauticSummary(
  creds: MauticCredentials,
  signal: AbortSignal,
  options: { readonly inactivityThresholdDays?: number } = {},
): Promise<MauticResult<CRMSummary>> {
  try {
    const [contactsPage, segments, campaigns] = await Promise.all([
      mauticGet<{
        total?: number;
        contacts?: Record<string, MauticRawContact>;
      }>(creds, "/api/contacts?limit=100&start=0", signal),
      mauticGet<{ lists?: Record<string, MauticRawSegment> }>(
        creds,
        "/api/segments?limit=200",
        signal,
      ),
      mauticGet<{ campaigns?: Record<string, MauticRawCampaign> }>(
        creds,
        "/api/campaigns?limit=200",
        signal,
      ),
    ]);
    const totalContacts = contactsPage.total ?? 0;
    const segmentList = Object.values(segments.lists ?? {}).map(normalizeSegment);
    const campaignList = Object.values(campaigns.campaigns ?? {}).map(normalizeCampaign);
    const thresholdMs =
      options.inactivityThresholdDays !== undefined
        ? options.inactivityThresholdDays * 24 * 60 * 60 * 1000
        : 60 * 24 * 60 * 60 * 1000;
    const thresholdIso = new Date(Date.now() - thresholdMs).toISOString();
    const raws = Object.values(contactsPage.contacts ?? {});
    const staleCount = raws.filter(
      (c) =>
        typeof c.lastActive === "string" &&
        c.lastActive.length > 0 &&
        c.lastActive < thresholdIso,
    ).length;
    const topSegments = [...segmentList]
      .filter((s) => typeof s.contactCount === "number")
      .sort((a, b) => (b.contactCount ?? 0) - (a.contactCount ?? 0))
      .slice(0, 5)
      .map((s) => ({ id: s.id, name: s.name, count: s.contactCount ?? 0 }));
    const value: CRMSummary = {
      totalContacts,
      totalSegments: segmentList.length,
      totalCampaigns: campaignList.length,
      contactsWithoutRecentActivity: staleCount,
      ...(topSegments.length > 0 ? { topSegments } : {}),
    };
    return ok(value);
  } catch (cause) {
    const { message, code } = classifyError(cause);
    return fail(message, code);
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

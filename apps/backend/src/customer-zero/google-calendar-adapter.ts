/**
 * GoogleCalendarAdapter — Customer Zero 03.
 *
 * Calendar capabilities behind the same Google connection used by
 * Gmail. The token lives in `gmailTokenStore` (renamed internally
 * but the export name is preserved for backward compatibility).
 *
 * Capabilities:
 *   - calendar.read  → listEvents + getEvent
 *   - calendar.create → createEvent
 *   - calendar.update → updateEvent
 *
 * Business-event objects are normalized — no Google Calendar JSON
 * leaks past the adapter.
 */

import { gmailTokenStore } from "./gmail-adapter.js";
import {
  getGoogleTokenStore,
  googleApiFetch,
  hasGrantedScope,
  refreshGoogleToken,
} from "./google-tokens.js";

/* ----------------------------------------------------------------------------
 * Normalized types.
 * --------------------------------------------------------------------------*/

export interface CalendarEvent {
  readonly id: string;
  readonly calendarId?: string;
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly attendees: readonly { readonly email: string; readonly displayName?: string }[];
  readonly organizer?: { readonly email: string; readonly displayName?: string };
  readonly status: "confirmed" | "tentative" | "cancelled";
  readonly htmlLink?: string;
  readonly businessIntent?: string;
}

export interface CreateEventInput {
  readonly summary: string;
  readonly description?: string;
  readonly location?: string;
  readonly startIso: string;
  readonly endIso: string;
  readonly attendees?: readonly string[];
  readonly businessIntent?: string;
}

/* ----------------------------------------------------------------------------
 * Adapter.
 * --------------------------------------------------------------------------*/

export interface CalendarAdapterInput {
  readonly organizationId: string;
  readonly userId: string;
}

export interface CalendarAdapterResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly errorCode?: "auth" | "unavailable" | "rate_limit" | "invalid_response";
  readonly message?: string;
}

function ok<T>(value: T): CalendarAdapterResult<T> {
  return { success: true, value };
}
function fail<T>(
  message: string,
  code: CalendarAdapterResult<T>["errorCode"] = "invalid_response",
): CalendarAdapterResult<T> {
  return { success: false, errorCode: code, message };
}

export class GoogleCalendarAdapter {
  constructor(private readonly input: CalendarAdapterInput) {}

  private async getAccessToken(requiredScope?: string): Promise<string | null> {
    const durable = await getGoogleTokenStore().get(
      this.input.organizationId,
      this.input.userId,
    );
    if (durable) {
      if (requiredScope && !hasGrantedScope(durable.scopes, requiredScope)) return null;
      if (new Date(durable.expiresAt).getTime() - 60_000 > Date.now()) {
        return durable.accessToken;
      }
      if (!durable.refreshToken) return null;
      try {
        const next = await refreshGoogleToken({
          refreshToken: durable.refreshToken,
          clientId: process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "",
          clientSecret: process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "",
        });
        await getGoogleTokenStore().put({
          ...durable,
          accessToken: next.accessToken,
          expiresAt: next.expiresAt,
          scopes: Array.from(new Set([...durable.scopes, ...next.scopes])),
        });
        return next.accessToken;
      } catch {
        return null;
      }
    }
    // Legacy in-memory fallback is retained for deterministic unit tests and
    // local development. Production always has the durable row above.
    const tokens = gmailTokenStore.get(this.input.organizationId, this.input.userId);
    if (!tokens) return null;
    if (new Date(tokens.expiresAt).getTime() - 60_000 > Date.now()) {
      return tokens.accessToken;
    }
    // Refresh on the fly using the shared Gmail refresh-token path.
    try {
      const next = await refreshGoogleAccessToken(tokens);
      gmailTokenStore.put(this.input.organizationId, this.input.userId, next);
      return next.accessToken;
    } catch {
      return null;
    }
  }

  async listEvents(input: {
    readonly timeMinIso: string;
    readonly timeMaxIso: string;
    readonly maxResults?: number;
  }): Promise<CalendarAdapterResult<readonly CalendarEvent[]>> {
    const accessToken = await this.getAccessToken(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    if (!accessToken) return fail("Google no está conectado.", "auth");
    const params = new URLSearchParams({
      timeMin: input.timeMinIso,
      timeMax: input.timeMaxIso,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: String(input.maxResults ?? 25),
    });
    const response = await googleApiFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Google rechazó la autorización.", "auth");
      if (response.status === 429) return fail("Google aplicó rate limit.", "rate_limit");
      if (response.status >= 500) return fail("Google no responde.", "unavailable");
      return fail(`Google devolvió ${response.status}.`, "invalid_response");
    }
    const data = (await response.json()) as {
      items?: Array<{
        id?: string;
        summary?: string;
        description?: string;
        location?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        attendees?: Array<{ email?: string; displayName?: string }>;
        organizer?: { email?: string; displayName?: string };
        status?: string;
        htmlLink?: string;
        extendedProperties?: { private?: { businessIntent?: string } };
      }>;
    };
    const items = (data.items ?? [])
      .filter((i): i is typeof i & { id: string; start: { dateTime: string }; end: { dateTime: string } } =>
        Boolean(i.id) && Boolean(i.start?.dateTime) && Boolean(i.end?.dateTime),
      )
      .map((i) => normalizeEvent(i, "primary"));
    return ok(items);
  }

  async getEvent(eventId: string): Promise<CalendarAdapterResult<CalendarEvent>> {
    const accessToken = await this.getAccessToken(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    if (!accessToken) return fail("Google no está conectado.", "auth");
    if (!eventId) return fail("ID de evento vacío.", "invalid_response");
    const response = await googleApiFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Google rechazó la autorización.", "auth");
      return fail(`Google devolvió ${response.status}.`, "invalid_response");
    }
    return ok(normalizeEvent((await response.json()) as GoogleCalendarEvent, "primary"));
  }

  async createEvent(
    input: CreateEventInput,
  ): Promise<CalendarAdapterResult<CalendarEvent>> {
    const accessToken = await this.getAccessToken(
      "https://www.googleapis.com/auth/calendar.events",
    );
    if (!accessToken) return fail("Google no está conectado.", "auth");
    const body: Record<string, unknown> = {
      summary: input.summary.slice(0, 998),
      start: { dateTime: input.startIso },
      end: { dateTime: input.endIso },
    };
    if (input.description) body.description = input.description.slice(0, 8000);
    if (input.location) body.location = input.location.slice(0, 500);
    if (input.attendees && input.attendees.length > 0) {
      body.attendees = input.attendees.map((email) => ({ email }));
    }
    if (input.businessIntent) {
      body.extendedProperties = { private: { businessIntent: input.businessIntent } };
    }
    const response = await googleApiFetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Google rechazó la autorización.", "auth");
      return fail(`Google no creó el evento (${response.status}).`, "invalid_response");
    }
    const event = normalizeEvent((await response.json()) as GoogleCalendarEvent, "primary");
    // A successful HTTP status without a provider event identity is not
    // evidence that the side effect happened.
    if (!event.id || !event.startIso || !event.endIso) {
      return fail("Google no ha confirmado el evento.", "invalid_response");
    }
    return ok(event);
  }

  async updateEvent(
    eventId: string,
    patch: Partial<CreateEventInput>,
  ): Promise<CalendarAdapterResult<CalendarEvent>> {
    const accessToken = await this.getAccessToken(
      "https://www.googleapis.com/auth/calendar.events",
    );
    if (!accessToken) return fail("Google no está conectado.", "auth");
    if (!eventId) return fail("ID de evento vacío.", "invalid_response");
    const body: Record<string, unknown> = {};
    if (patch.summary) body.summary = patch.summary.slice(0, 998);
    if (patch.description) body.description = patch.description.slice(0, 8000);
    if (patch.location) body.location = patch.location.slice(0, 500);
    if (patch.startIso) body.start = { dateTime: patch.startIso };
    if (patch.endIso) body.end = { dateTime: patch.endIso };
    if (patch.attendees) body.attendees = patch.attendees.map((email) => ({ email }));
    const response = await googleApiFetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      if (response.status === 401) return fail("Google rechazó la autorización.", "auth");
      return fail(`Google no actualizó el evento (${response.status}).`, "invalid_response");
    }
    return ok(normalizeEvent((await response.json()) as GoogleCalendarEvent));
  }
}

/* ----------------------------------------------------------------------------
 * Helpers.
 * --------------------------------------------------------------------------*/

interface GoogleCalendarEvent {
  id?: string;
  calendarId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
  organizer?: { email?: string; displayName?: string };
  status?: string;
  htmlLink?: string;
  extendedProperties?: { private?: { businessIntent?: string } };
}

function normalizeEvent(raw: GoogleCalendarEvent, fallbackCalendarId?: string): CalendarEvent {
  return {
    id: raw.id ?? "",
    ...((raw.calendarId ?? fallbackCalendarId) ? { calendarId: raw.calendarId ?? fallbackCalendarId! } : {}),
    summary: raw.summary ?? "(Sin título)",
    ...(raw.description ? { description: raw.description } : {}),
    ...(raw.location ? { location: raw.location } : {}),
    startIso: raw.start?.dateTime ?? "",
    endIso: raw.end?.dateTime ?? "",
    attendees: (raw.attendees ?? [])
      .filter((a): a is { email: string; displayName?: string } => Boolean(a.email))
      .map((a) => ({ email: a.email, ...(a.displayName ? { displayName: a.displayName } : {}) })),
    ...(raw.organizer?.email
      ? { organizer: { email: raw.organizer.email, ...(raw.organizer.displayName ? { displayName: raw.organizer.displayName } : {}) } }
      : {}),
    status:
      raw.status === "cancelled"
        ? "cancelled"
        : raw.status === "tentative"
          ? "tentative"
          : "confirmed",
    ...(raw.htmlLink ? { htmlLink: raw.htmlLink } : {}),
    ...(raw.extendedProperties?.private?.businessIntent
      ? { businessIntent: raw.extendedProperties.private.businessIntent }
      : {}),
  };
}

/* ----------------------------------------------------------------------------
 * Token refresh — shared Gmail token refresh path.
 * --------------------------------------------------------------------------*/

interface GmailTokensLike {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
  readonly email: string;
  readonly displayName: string;
}

async function refreshGoogleAccessToken(
  tokens: GmailTokensLike,
): Promise<GmailTokensLike> {
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"] ?? "";
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials not configured");
  }
  const response = await googleApiFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!response.ok) {
    throw new Error(`Google refresh returned ${response.status}`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!data.access_token) {
    throw new Error("Google refresh missing access_token");
  }
  return {
    accessToken: data.access_token,
    refreshToken: tokens.refreshToken,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString(),
    scopes: (data.scope ?? tokens.scopes.join(" ")).split(/\s+/).filter(Boolean),
    email: tokens.email,
    displayName: tokens.displayName,
  };
}

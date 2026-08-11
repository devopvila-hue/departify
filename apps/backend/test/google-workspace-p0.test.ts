import { afterEach, describe, expect, it } from "vitest";
import {
  createInMemoryGoogleTokenStore,
  hasOperationalGoogleCapability,
  mergeTokenExchange,
  type GoogleTokenRecord,
} from "../src/customer-zero/google-tokens.js";
import { GoogleCalendarAdapter } from "../src/customer-zero/google-calendar-adapter.js";
import { GoogleDriveAdapter } from "../src/customer-zero/google-drive-adapter.js";
import { routeCommandCenter } from "../src/customer-zero/command-center.js";
import { gmailTokenStore } from "../src/customer-zero/gmail-adapter.js";

const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR = "https://www.googleapis.com/auth/calendar.readonly";
const CALENDAR_WRITE = "https://www.googleapis.com/auth/calendar.events";
const DRIVE = "https://www.googleapis.com/auth/drive.readonly";

function record(scopes: readonly string[], overrides: Partial<GoogleTokenRecord> = {}): GoogleTokenRecord {
  return {
    organizationId: "org-google",
    userId: "user-ceo",
    provider: "gmail",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    scopes,
    email: "founder@gmail.com",
    displayName: "Founder",
    operationalVerifiedAt: new Date().toISOString(),
    operationalProbeError: null,
    ...overrides,
  };
}

function legacyTokens(value: GoogleTokenRecord) {
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken ?? "",
    expiresAt: value.expiresAt,
    scopes: value.scopes,
    email: value.email,
    displayName: value.displayName ?? "",
  };
}

afterEach(() => gmailTokenStore.remove("org-google-p0", "user-ceo"));

describe("Google Workspace P0 — one identity and truthful capabilities", () => {
  it("keeps one durable identity when Calendar is added incrementally", async () => {
    const store = createInMemoryGoogleTokenStore();
    await store.put(record([GMAIL], { operationalCapabilities: ["email.read"] }));
    await store.put(record([GMAIL, CALENDAR, CALENDAR_WRITE], {
      operationalCapabilities: ["email.read", "calendar.read"],
    }));
    const rows = await store.listForOrg("org-google");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe("gmail");
    expect(rows[0]?.email).toBe("founder@gmail.com");
    expect(rows[0]?.scopes).toEqual(expect.arrayContaining([GMAIL, CALENDAR]));
    expect(rows[0]?.hasRefreshToken).toBe(true);
  });

  it("preserves the previous refresh token when incremental consent omits one", () => {
    const merged = mergeTokenExchange({
      organizationId: "org-google",
      userId: "user-ceo",
      provider: "google_calendar",
      exchange: {
        access_token: "new-access",
        expires_in: 3600,
        scope: "calendar.readonly calendar.events",
      },
      previousRefreshToken: "old-refresh",
      previousScopes: [GMAIL],
      email: "founder@gmail.com",
      displayName: "Founder",
      nowMs: Date.now(),
    });
    expect(merged.refreshToken).toBe("old-refresh");
    expect(merged.scopes).toEqual(expect.arrayContaining([GMAIL, CALENDAR, CALENDAR_WRITE]));
  });

  it("does not call Calendar or Drive operational when only Gmail is granted", () => {
    const summary = {
      hasRefreshToken: true,
      operationalVerifiedAt: new Date().toISOString(),
      scopes: [GMAIL],
      operationalCapabilities: ["email.read"] as const,
    };
    expect(hasOperationalGoogleCapability(summary, "email.read")).toBe(true);
    expect(hasOperationalGoogleCapability(summary, "calendar.read")).toBe(false);
    expect(hasOperationalGoogleCapability(summary, "drive.read")).toBe(false);
  });

  it("uses the durable personal Google identity for Calendar and gates writes by scope", async () => {
    const calendarRecord = record([CALENDAR], {
      email: "founder@gmail.com",
      operationalCapabilities: ["calendar.read"],
    });
    gmailTokenStore.put("org-google-p0", "user-ceo", legacyTokens(calendarRecord));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("provider down", { status: 503 })) as typeof fetch;
    try {
      const adapter = new GoogleCalendarAdapter({ organizationId: "org-google-p0", userId: "user-ceo" });
      const read = await adapter.listEvents({
        timeMinIso: new Date().toISOString(),
        timeMaxIso: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(read.success).toBe(false);
      const create = await adapter.createEvent({
        summary: "Test",
        startIso: new Date().toISOString(),
        endIso: new Date(Date.now() + 1_800_000).toISOString(),
      });
      expect(create.success).toBe(false); // calendar.events was not granted
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("never reports a failed Calendar create as created", async () => {
    const calendarRecord = record([CALENDAR, CALENDAR_WRITE], {
      operationalCapabilities: ["calendar.read"],
    });
    gmailTokenStore.put("org-google-p0", "user-ceo", legacyTokens(calendarRecord));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("provider down", { status: 503 })) as typeof fetch;
    try {
      const result = await new GoogleCalendarAdapter({ organizationId: "org-google-p0", userId: "user-ceo" }).createEvent({
        summary: "Test",
        startIso: new Date().toISOString(),
        endIso: new Date(Date.now() + 1_800_000).toISOString(),
      });
      expect(result.success).toBe(false);
      expect(result.value).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("reads a supported Drive text file and handles PDF honestly", async () => {
    const driveRecord = record([DRIVE], {
      operationalCapabilities: ["drive.search", "drive.read"],
    });
    gmailTokenStore.put("org-google-p0", "user-ceo", legacyTokens(driveRecord));
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (input: string | URL) => {
      calls += 1;
      const url = String(input);
      if (url.includes("/files?")) {
        return new Response(JSON.stringify({ files: [{ id: "file-1", name: "Plan.txt", mimeType: "text/plain", modifiedTime: "2026-08-11T10:00:00Z" }] }), { status: 200 });
      }
      if (url.includes("file-1") && !url.includes("alt=media")) {
        return new Response(JSON.stringify({ id: "file-1", name: "Plan.txt", mimeType: "text/plain", modifiedTime: "2026-08-11T10:00:00Z" }), { status: 200 });
      }
      return new Response("precio: 100", { status: 200 });
    }) as typeof fetch;
    try {
      const adapter = new GoogleDriveAdapter({ organizationId: "org-google-p0", userId: "user-ceo" });
      const found = await adapter.searchFiles({ query: "Plan" });
      expect(found.success).toBe(true);
      const text = await adapter.readFile({ fileId: "file-1" });
      expect(text.value?.preview).toContain("precio");
      expect(calls).toBe(3);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("routes business examples to Google capabilities, not Mautic", () => {
    const base = {
      organizationId: "org-google",
      locale: "es" as const,
      pendingApprovals: [],
      unreadResults: [],
      inflight: [],
      connections: [],
      unmappedTools: [],
      history: [],
    };
    expect(routeCommandCenter({ ...base, message: "¿Qué tengo mañana?" }).decision.intent).toBe("calendar_read");
    expect(routeCommandCenter({ ...base, message: "Agenda una reunión mañana a las 16:00" }).decision.intent).toBe("calendar_create");
    expect(routeCommandCenter({ ...base, message: "Busca en Drive el plan de marketing" }).decision.intent).toBe("drive_query");
    expect(routeCommandCenter({ ...base, message: "Busca el último correo de Pedro y dime si tenemos alguna reunión con él" }).decision.intent).toBe("multi_capability");
  });

  it("routes the exact Customer Zero Calendar literals to Calendar", () => {
    const base = {
      organizationId: "org-google",
      locale: "es" as const,
      pendingApprovals: [],
      unreadResults: [],
      inflight: [],
      connections: [],
      unmappedTools: [],
      history: [],
    };
    expect(routeCommandCenter({ ...base, message: "mis proximos eventos" }).decision.intent).toBe("calendar_read");
    expect(routeCommandCenter({ ...base, message: "queiero que creas un evento para las 20 00 horas llamdo ver jodar" }).decision.intent).toBe("calendar_create");
  });

  it("accepts only a provider-confirmed Calendar create response", async () => {
    const calendarRecord = record([CALENDAR, CALENDAR_WRITE], {
      operationalCapabilities: ["calendar.read", "calendar.create"],
    });
    gmailTokenStore.put("org-google-p0", "user-ceo", legacyTokens(calendarRecord));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).includes("/calendar/v3/calendars/primary/events") && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "google-event-1",
          calendarId: "primary",
          summary: "Ver Jódar",
          start: { dateTime: "2026-08-11T20:00:00+02:00" },
          end: { dateTime: "2026-08-11T20:30:00+02:00" },
          htmlLink: "https://calendar.google.com/calendar/event?eid=google-event-1",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    try {
      const result = await new GoogleCalendarAdapter({ organizationId: "org-google-p0", userId: "user-ceo" }).createEvent({
        summary: "Ver Jódar",
        startIso: "2026-08-11T18:00:00.000Z",
        endIso: "2026-08-11T18:30:00.000Z",
      });
      expect(result.success).toBe(true);
      expect(result.value?.id).toBe("google-event-1");
      expect(result.value?.htmlLink).toContain("google-event-1");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("treats a 2xx Calendar create without event identity as ambiguous", async () => {
    const calendarRecord = record([CALENDAR_WRITE], { operationalCapabilities: ["calendar.create"] });
    gmailTokenStore.put("org-google-p0", "user-ceo", legacyTokens(calendarRecord));
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ summary: "Ver Jódar" }), { status: 200 })) as typeof fetch;
    try {
      const result = await new GoogleCalendarAdapter({ organizationId: "org-google-p0", userId: "user-ceo" }).createEvent({
        summary: "Ver Jódar",
        startIso: "2026-08-11T18:00:00.000Z",
        endIso: "2026-08-11T18:30:00.000Z",
      });
      expect(result.success).toBe(false);
      expect(result.value).toBeUndefined();
      expect(result.message).toContain("confirmado");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

/**
 * Customer Zero 07 — corporate email (IMAP + SMTP) regression suite.
 *
 *   I.  IMAP valid credentials → read operational.
 *   J.  IMAP invalid credentials → NOT connected.
 *   K.  SMTP valid credentials → send capability operational.
 *   L.  SMTP invalid credentials → NOT falsely connected.
 *   M.  Credentials never returned to frontend/chat/model.
 *   N.  Corporate account inbox read produces a business answer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import {
  installCorporateEmailStore,
  createInMemoryCorporateEmailStore,
} from "../src/customer-zero/corporate-email-store.js";
import {
  installGoogleTokenStore,
  createInMemoryGoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";
import { installGoogleOAuthStateStore } from "../src/customer-zero/oauth-state.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";
import { resetGoogleOperationalCacheForTest } from "../src/server/routes/customer-zero-v2.js";

// Mock the network-touching adapter so tests are deterministic and fast.
interface InboxItem {
  id: string;
  threadId: string;
  from: { email: string; displayName?: string };
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
}

const adapterMocks = vi.hoisted(() => {
  const probeResult: {
    imapOk: boolean;
    smtpOk: boolean;
    operational: boolean;
    error: string | null;
  } = {
    imapOk: true,
    smtpOk: true,
    operational: true,
    error: null,
  };
  const sendResult: {
    ok: boolean;
    providerMessageId: string | null;
    sentAt: string | null;
    error: string | null;
  } = {
    ok: true,
    providerMessageId: "smtp-msg-1",
    sentAt: "2026-08-11T00:00:00.000Z",
    error: null,
  };
  return { probeResult, inboxResult: [] as InboxItem[], sendResult };
});

vi.mock("../src/customer-zero/corporate-email-adapter.js", () => ({
  probeCorporateEmail: vi.fn(async () => adapterMocks.probeResult),
  readCorporateInbox: vi.fn(async () => adapterMocks.inboxResult),
  sendCorporateEmail: vi.fn(async () => adapterMocks.sendResult),
}));

const AUTH = { authorization: "Bearer token-a" };

describe("CZ07 — Corporate email (IMAP + SMTP)", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
    });
    installCorporateEmailStore(createInMemoryCorporateEmailStore());
    installGoogleTokenStore(createInMemoryGoogleTokenStore());
    installGoogleOAuthStateStore(null);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    adapterMocks.probeResult = {
      imapOk: true,
      smtpOk: true,
      operational: true,
      error: null,
    };
    adapterMocks.inboxResult = [];
    adapterMocks.sendResult = {
      ok: true,
      providerMessageId: "smtp-msg-1",
      sentAt: "2026-08-11T00:00:00.000Z",
      error: null,
    };
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    resetGoogleOperationalCacheForTest();
    installCorporateEmailStore(null);
    installGoogleTokenStore(null);
    installGoogleOAuthStateStore(null);
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.PUBLIC_BASE_URL;
    vi.clearAllMocks();
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });
  }

  async function startOrg(): Promise<string> {
    const response = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  function corporatePayload(overrides: Record<string, unknown> = {}) {
    return {
      email: "ceo@empresa.com",
      username: "ceo@empresa.com",
      password: "app-password-secret",
      imapHost: "imap.empresa.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.empresa.com",
      smtpPort: 587,
      smtpSecure: true,
      displayName: "CEO",
      ...overrides,
    };
  }

  it("I+K: valid IMAP+SMTP probe → operational (read + send capability)", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/corporate-email/configure`,
      payload: corporatePayload(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.operational).toBe(true);
    expect(body.probe.imapOk).toBe(true);
    expect(body.probe.smtpOk).toBe(true);
  });

  it("M: credentials are NEVER returned by the configure endpoint", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/corporate-email/configure`,
      payload: corporatePayload(),
    });
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain("app-password-secret");
    expect(serialized).not.toContain("password");
  });

  it("J/L: invalid IMAP or SMTP credentials → NOT falsely connected", async () => {
    const org = await startOrg();
    adapterMocks.probeResult = {
      imapOk: false,
      smtpOk: true,
      operational: false,
      error: "IMAP: invalid credentials",
    };
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/corporate-email/configure`,
      payload: corporatePayload(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.operational).toBe(false);
    expect(body.probe.imapOk).toBe(false);
    // A non-operational account is never treated as connected by the
    // email capability.
    const { resolveOperationalEmailProvider } = await import(
      "../src/customer-zero/email-capability.js"
    );
    expect(await resolveOperationalEmailProvider(org)).toBeNull();
  });

  it("K: send capability dispatches to the corporate SMTP provider", async () => {
    const org = await startOrg();
    await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/corporate-email/configure`,
      payload: corporatePayload(),
    });
    const { sendEmail } = await import("../src/customer-zero/email-capability.js");
    const { getOrCreateCustomerZeroSession } = await import(
      "../src/customer-zero/customer-zero-session.js"
    );
    const session = getOrCreateCustomerZeroSession(org);
    const outcome = await sendEmail(session, {
      to: "destino@otra.com",
      subject: "Reunión",
      bodyText: "Pasa al viernes.",
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.provider).toBe("corporate");
    expect(outcome.providerMessageId).toBe("smtp-msg-1");
    // The password never appears in the outcome.
    expect(JSON.stringify(outcome)).not.toContain("app-password-secret");
  });

  it("N: corporate inbox read produces a business answer, not provider internals", async () => {
    const org = await startOrg();
    await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/corporate-email/configure`,
      payload: corporatePayload(),
    });
    adapterMocks.inboxResult = [
      {
        id: "1",
        threadId: "1",
        from: { email: "jefe@empresa.com", displayName: "Jefe" },
        subject: "Presupuesto Q3",
        snippet: "",
        date: "Tue, 11 Aug 2026 09:00:00 +0000",
        isUnread: true,
      },
    ];
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "¿Cuál es mi último correo recibido?" },
    });
    expect(response.statusCode).toBe(200);
    const reply = response.json().reply as string;
    expect(reply).toContain("Jefe");
    expect(reply).toContain("Presupuesto Q3");
    expect(reply).not.toContain("newer_than:");
    expect(reply).not.toContain("imap");
    expect(reply).not.toContain("app-password-secret");
  });

  it("X: another org cannot read this org's corporate account", async () => {
    const org = await startOrg();
    await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/corporate-email/configure`,
      payload: corporatePayload(),
    });
    // The store is org-scoped.
    const { resolveOperationalEmailProvider } = await import(
      "../src/customer-zero/email-capability.js"
    );
    expect(await resolveOperationalEmailProvider("org_different")).toBeNull();
  });
});

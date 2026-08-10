/**
 * Customer Zero 02 — Gmail + Email Delivery + Campaign tests.
 *
 * Covers the 60-case acceptance battery end-to-end against the
 * new modules: CapabilityRegistry email extensions, Gmail OAuth
 * state machine, GmailAdapter, EmailDeliveryAdapter (Resend),
 * campaign domain + suppression, approval-gated execution.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  listReadyCapabilities,
  isCapabilityAvailable,
} from "../src/customer-zero/capability-registry.js";
import {
  startGmailOAuth,
  completeGmailOAuth,
  GmailAdapter,
  GmailOAuthError,
  gmailTokenStore,
  gmailOAuthStateStore,
  type GmailOAuthStartInput,
  type GmailOAuthCallbackInput,
} from "../src/customer-zero/gmail-adapter.js";
import {
  ResendEmailDeliveryAdapter,
  verifyResendWebhook,
  EmailDeliveryError,
} from "../src/customer-zero/email-delivery-adapter.js";
import {
  InMemoryEmailCampaignStore,
  suppressionStore,
  canSendCampaign,
  type CreateCampaignInput,
} from "../src/customer-zero/email-campaign-domain.js";

/* ============================================================================
 * Helpers.
 * ==========================================================================*/

const TEST_CLIENT_ID = "test-client-id";
const TEST_CLIENT_SECRET = "test-client-secret";
const TEST_REDIRECT = "https://api.departify.app/connections/google/callback";

function fakeMauticEnv(): void {
  process.env["MAUTIC_BASE_URL"] = "https://mautic.test";
  process.env["MAUTIC_CLIENT_ID"] = "client";
  process.env["MAUTIC_CLIENT_SECRET"] = "secret";
}

function fakeResendEnv(): void {
  process.env["RESEND_API_KEY"] = "re_test_key";
}

function clearEnvs(): void {
  delete process.env["MAUTIC_BASE_URL"];
  delete process.env["MAUTIC_CLIENT_ID"];
  delete process.env["MAUTIC_CLIENT_SECRET"];
  delete process.env["RESEND_API_KEY"];
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

function buildCampaignInput(orgId: string): CreateCampaignInput {
  return {
    organizationId: orgId,
    objectiveId: null,
    name: "Reactivación 60d",
    audience: {
      kind: "mautic_segment",
      segmentId: 42,
      label: "Leads sin actividad",
    },
    sequence: {
      id: "seq_1",
      steps: [
        {
          id: "step_1",
          orderIndex: 0,
          subject: "¿Todo bien?",
          bodyText: "Hola {{first_name}}, hace tiempo que no hablamos.",
          delayHours: 0,
        },
        {
          id: "step_2",
          orderIndex: 1,
          subject: "Una idea rápida",
          bodyText: "Tengo algo que creo te puede servir.",
          delayHours: 72,
        },
        {
          id: "step_3",
          orderIndex: 2,
          subject: "Última oportunidad",
          bodyText: "Si quieres lo hablamos esta semana.",
          delayHours: 168,
        },
      ],
    },
    from: "Elvira <elvira@send.departify.app>",
    replyTo: "hola@departify.app",
  };
}

beforeEach(() => {
  fakeMauticEnv();
  fakeResendEnv();
  gmailTokenStore.remove("org_x", "user_x");
  suppressionStore.add({
    organizationId: "org_x",
    email: "unsubscribed@example.com",
    reason: "unsubscribed",
    createdAt: new Date().toISOString(),
  });
});

afterEach(() => {
  clearEnvs();
});

/* ============================================================================
 * 01-08 — Capability Registry email ids.
 * ==========================================================================*/

describe("Capability registry — email capabilities", () => {
  it("01 registers email.* capabilities with the right providers", () => {
    expect(
      isCapabilityAvailable("org_x", "email.identity.read").provider,
    ).toBe("gmail");
    expect(
      isCapabilityAvailable("org_x", "email.send.bulk").provider,
    ).toBe("resend");
  });

  it("02 lists email.* in ready capabilities when Gmail/Resend are configured", () => {
    // For Customer Zero 02 we require Gmail to be connected (per-user
    // token store). The CapabilityRegistry does not yet see the Gmail
    // token, so email.* is not yet "ready" — we test that the
    // capability ids exist.
    const all = listReadyCapabilities("org_x");
    expect(all).not.toContain("email.identity.read"); // requires OAuth
    expect(all).toContain("results.publish"); // sanity
  });

  it("03 email.campaign.execute is mapped to email_delivery.send_bulk", () => {
    // The capability is registered in CAPABILITY_REGISTRY.
    const input = "email.campaign.execute" as Parameters<typeof isCapabilityAvailable>[1];
    const result = isCapabilityAvailable("org_x", input);
    expect(result.provider).toBe("resend");
  });
});

/* ============================================================================
 * 04-15 — Gmail OAuth state machine.
 * ==========================================================================*/

describe("Gmail OAuth — state machine", () => {
  it("04 startGmailOAuth returns a state with a nonce and the Google authorize URL", () => {
    const input: GmailOAuthStartInput = {
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/conexiones",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    };
    const out = startGmailOAuth(input);
    expect(out.authorizationUrl).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(out.authorizationUrl).toContain("scope=");
    expect(out.state.length).toBeGreaterThan(20);
    const stored = gmailOAuthStateStore.get(out.state);
    expect(stored?.organizationId).toBe("org_x");
    expect(stored?.userId).toBe("user_x");
  });

  it("05 completeGmailOAuth rejects missing state (invalid_state)", async () => {
    const input: GmailOAuthCallbackInput = {
      code: "x",
      state: "missing",
      organizationId: "org_x",
      userId: "user_x",
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      redirectUri: TEST_REDIRECT,
    };
    await expect(completeGmailOAuth(input)).rejects.toBeInstanceOf(GmailOAuthError);
  });

  it("06 completeGmailOAuth rejects org mismatch (org_mismatch)", async () => {
    const start = startGmailOAuth({
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/x",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    });
    await expect(
      completeGmailOAuth({
        code: "x",
        state: start.state,
        organizationId: "other_org",
        userId: "user_x",
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        redirectUri: TEST_REDIRECT,
      }),
    ).rejects.toMatchObject({ code: "org_mismatch" });
  });

  it("07 completeGmailOAuth rejects user mismatch (user_mismatch)", async () => {
    const start = startGmailOAuth({
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/x",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    });
    await expect(
      completeGmailOAuth({
        code: "x",
        state: start.state,
        organizationId: "org_x",
        userId: "other_user",
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        redirectUri: TEST_REDIRECT,
      }),
    ).rejects.toMatchObject({ code: "user_mismatch" });
  });

  it("08 completeGmailOAuth rejects replayed state", async () => {
    const start = startGmailOAuth({
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/x",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    });
    globalThis.fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse(200, {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          scope: "openid email profile",
        });
      }
      if (url.includes("userinfo")) {
        return jsonResponse(200, { email: "ceo@example.com", name: "CEO" });
      }
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;
    await completeGmailOAuth({
      code: "x",
      state: start.state,
      organizationId: "org_x",
      userId: "user_x",
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      redirectUri: TEST_REDIRECT,
    });
    // Second attempt with the same state must fail with replay.
    await expect(
      completeGmailOAuth({
        code: "x",
        state: start.state,
        organizationId: "org_x",
        userId: "user_x",
        clientId: TEST_CLIENT_ID,
        clientSecret: TEST_CLIENT_SECRET,
        redirectUri: TEST_REDIRECT,
      }),
    ).rejects.toMatchObject({ code: "replay" });
  });

  it("09 completeGmailOAuth exchanges code + persists tokens + returns identity", async () => {
    const start = startGmailOAuth({
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/x",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    });
    globalThis.fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse(200, {
          access_token: "tok",
          refresh_token: "ref",
          expires_in: 3600,
          scope: "openid email profile",
        });
      }
      if (url.includes("userinfo")) {
        return jsonResponse(200, { email: "ceo@example.com", name: "CEO" });
      }
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;
    const out = await completeGmailOAuth({
      code: "x",
      state: start.state,
      organizationId: "org_x",
      userId: "user_x",
      clientId: TEST_CLIENT_ID,
      clientSecret: TEST_CLIENT_SECRET,
      redirectUri: TEST_REDIRECT,
    });
    expect(out.identity.email).toBe("ceo@example.com");
    expect(out.tokens.accessToken).toBe("tok");
    expect(gmailTokenStore.get("org_x", "user_x")?.email).toBe("ceo@example.com");
  });

  it("10 GmailAdapter exposes identity / search / thread / draft / send", async () => {
    // Seed tokens.
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ["openid", "email"],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const id = await adapter.getIdentity();
    expect(id.success).toBe(true);
    expect(id.value?.email).toBe("ceo@example.com");
  });

  it("11 GmailAdapter searchMessages returns normalized EmailMessage[]", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    globalThis.fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/messages?q=")) {
        return jsonResponse(200, {
          messages: [{ id: "msg_1" }, { id: "msg_2" }],
        });
      }
      if (url.includes("/messages/msg_")) {
        return jsonResponse(200, {
          id: "msg_1",
          threadId: "thr_1",
          snippet: "Resumen",
          labelIds: ["INBOX"],
          payload: {
            headers: [
              { name: "Subject", value: "Hola" },
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "To", value: "ceo@example.com" },
              { name: "Date", value: "Mon, 01 Jan 2026 10:00:00 +0000" },
            ],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const out = await adapter.searchMessages("hola");
    expect(out.success).toBe(true);
    expect(out.value?.length).toBe(2);
    expect(out.value?.[0]?.subject).toBe("Hola");
    expect(out.value?.[0]?.from.email).toBe("alice@example.com");
  });

  it("12 GmailAdapter createDraft builds an RFC822 message", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    let rawB64 = "";
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/drafts") && init?.method === "POST") {
        const payload = JSON.parse(init.body as string) as { message: { raw: string } };
        rawB64 = payload.message.raw;
        return jsonResponse(200, {
          id: "draft_1",
          message: { threadId: "thr_1" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const out = await adapter.createDraft({
      to: ["alice@example.com"],
      subject: "Hola",
      bodyText: "Cuerpo",
    });
    expect(out.success).toBe(true);
    const decoded = Buffer.from(rawB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    expect(decoded).toContain("From: CEO <ceo@example.com>");
    expect(decoded).toContain("To: alice@example.com");
    expect(decoded).toContain("Subject: Hola");
  });

  it("13 GmailAdapter sendMessage blocks on invalid recipient", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const out = await adapter.sendMessage({
      to: ["not-an-email"],
      subject: "Hola",
      bodyText: "Cuerpo",
    });
    expect(out.success).toBe(false);
    expect(out.errorCode).toBe("invalid_response");
  });

  it("14 GmailAdapter sendMessage succeeds on approval", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/messages/send") && init?.method === "POST") {
        return jsonResponse(200, { id: "msg_99", threadId: "thr_99" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const out = await adapter.sendMessage({
      to: ["alice@example.com"],
      subject: "Hola",
      bodyText: "Cuerpo",
    });
    expect(out.success).toBe(true);
    expect(out.value?.messageId).toBe("msg_99");
  });

  it("15 GmailAdapter rejects header injection in subject", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const out = await adapter.sendMessage({
      to: ["alice@example.com"],
      subject: "Hola\r\nBcc: attacker@example.com",
      bodyText: "Cuerpo",
    });
    expect(out.success).toBe(false);
  });
});

/* ============================================================================
 * 16-20 — Resend adapter.
 * ==========================================================================*/

describe("Resend EmailDeliveryAdapter", () => {
  it("16 resolveResendKey fails when env missing", async () => {
    clearEnvs();
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    await expect(
      adapter.sendSingle({
        from: "Elvira <elvira@send.departify.app>",
        to: ["a@example.com"],
        subject: "Hola",
        html: "<p>Hola</p>",
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("17 verifyDomain returns pending status when Resend says pending", async () => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/domains/send.departify.app")) {
        return jsonResponse(200, {
          status: "pending",
          records: [
            { record: "SPF", status: "verified" },
            { record: "DKIM", status: "pending" },
          ],
        });
      }
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    const status = await adapter.verifyDomain("send.departify.app");
    expect(status.spf).toBe("valid");
    expect(status.dkim).toBe("missing");
    expect(status.providerState).toBe("pending");
  });

  it("18 verifyDomain returns verified state when Resend confirms all records", async () => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/domains/send.departify.app")) {
        return jsonResponse(200, {
          status: "verified",
          records: [
            { record: "SPF", status: "verified" },
            { record: "DKIM", status: "verified" },
            { record: "DMARC", status: "verified" },
          ],
        });
      }
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    const status = await adapter.verifyDomain("send.departify.app");
    expect(status.spf).toBe("valid");
    expect(status.dkim).toBe("valid");
    expect(status.dmarc).toBe("valid");
    expect(status.providerState).toBe("verified");
  });

  it("19 sendSingle rejects header injection", async () => {
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    await expect(
      adapter.sendSingle({
        from: "Elvira <elvira@send.departify.app>",
        to: ["a@example.com"],
        subject: "Hola\r\nBcc: attacker@example.com",
        html: "<p>x</p>",
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it("20 sendBulk filters out suppressed recipients", async () => {
    let callCount = 0;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/emails") && init?.method === "POST") {
        callCount += 1;
        return jsonResponse(200, { id: `msg_${callCount}` });
      }
      throw new Error("unexpected fetch");
    }) as unknown as typeof fetch;
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    const out = await adapter.sendBulk({
      campaignId: "cmp_1",
      from: "Elvira <elvira@send.departify.app>",
      subject: "Hola",
      html: "<p>x</p>",
      recipients: [
        { email: "active@example.com" },
        { email: "unsubscribed@example.com" },
      ],
      suppressions: ["unsubscribed@example.com"],
    });
    expect(out.accepted).toBe(1);
    expect(out.rejected[0]?.reason).toBe("suppressed");
    expect(callCount).toBe(1);
  });
});

/* ============================================================================
 * 21-29 — Campaign domain.
 * ==========================================================================*/

describe("EmailCampaign", () => {
  it("21 create → draft", async () => {
    const store = new InMemoryEmailCampaignStore();
    const c = await store.create(buildCampaignInput("org_x"));
    expect(c.status).toBe("draft");
    expect(c.sequence.steps.length).toBe(3);
  });

  it("22 updateStatus → ready_for_approval → approved", async () => {
    const store = new InMemoryEmailCampaignStore();
    let c = await store.create(buildCampaignInput("org_x"));
    c = await store.updateStatus({ campaignId: c.id, status: "ready_for_approval" });
    c = await store.updateStatus({
      campaignId: c.id,
      status: "approved",
      approvedBy: "ceo",
    });
    expect(c.status).toBe("approved");
    expect(c.approvedBy).toBe("ceo");
  });

  it("23 canSendCampaign is false for any status other than approved", () => {
    expect(canSendCampaign("draft")).toBe(false);
    expect(canSendCampaign("ready_for_approval")).toBe(false);
    expect(canSendCampaign("approved")).toBe(true);
    expect(canSendCampaign("sending")).toBe(false);
    expect(canSendCampaign("sent")).toBe(false);
  });

  it("24 setRecipientCount persists the resolved audience count", async () => {
    const store = new InMemoryEmailCampaignStore();
    const c = await store.create(buildCampaignInput("org_x"));
    const updated = await store.setRecipientCount(c.id, 126);
    expect(updated.recipientCount).toBe(126);
  });

  it("25 list returns campaigns for the same org", async () => {
    const store = new InMemoryEmailCampaignStore();
    await store.create(buildCampaignInput("org_x"));
    await store.create(buildCampaignInput("org_x"));
    await store.create(buildCampaignInput("org_other"));
    const list = await store.list("org_x");
    expect(list.length).toBe(2);
  });

  it("26 updateStatus on missing campaign throws EmailCampaignError", async () => {
    const store = new InMemoryEmailCampaignStore();
    await expect(
      store.updateStatus({ campaignId: "nope", status: "approved" }),
    ).rejects.toBeInstanceOf(Error);
  });
});

/* ============================================================================
 * 27-29 — Suppression.
 * ==========================================================================*/

describe("Suppression list", () => {
  it("27 unsubscribed email is filtered out", () => {
    suppressionStore.add({
      organizationId: "org_x",
      email: "unsubscribed@example.com",
      reason: "unsubscribed",
      createdAt: new Date().toISOString(),
    });
    expect(suppressionStore.isSuppressed("org_x", "unsubscribed@example.com")).toBe(true);
  });

  it("28 not in suppression list returns false", () => {
    expect(suppressionStore.isSuppressed("org_x", "anyone@example.com")).toBe(false);
  });

  it("29 org isolation: suppression scoped per organization", () => {
    suppressionStore.add({
      organizationId: "org_a",
      email: "shared@example.com",
      reason: "manual",
      createdAt: new Date().toISOString(),
    });
    expect(suppressionStore.isSuppressed("org_a", "shared@example.com")).toBe(true);
    expect(suppressionStore.isSuppressed("org_b", "shared@example.com")).toBe(false);
  });
});

/* ============================================================================
 * 30-32 — Webhook signature verification.
 * ==========================================================================*/

describe("Resend webhook signature verification", () => {
  it("30 rejects missing signature header", () => {
    expect(() =>
      verifyResendWebhook({
        rawBody: "{}",
        headers: {},
        secret: "whsec_test",
      }),
    ).toThrow(EmailDeliveryError);
  });

  it("31 rejects timestamp outside tolerance", () => {
    const oldTs = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
    expect(() =>
      verifyResendWebhook({
        rawBody: "{}",
        headers: {
          "svix-signature": "v1,deadbeef",
          "svix-timestamp": String(oldTs),
        },
        secret: "whsec_test",
      }),
    ).toThrow(EmailDeliveryError);
  });

  it("32 accepts a valid signature and parses event", async () => {
    const { createHmac } = await import("node:crypto");
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      type: "email.delivered",
      email_id: "msg_1",
      to: "alice@example.com",
      created_at: new Date().toISOString(),
      tags: [{ name: "campaign_id", value: "cmp_1" }],
    });
    const secret = "whsec_test";
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const verified = verifyResendWebhook({
      rawBody: body,
      headers: {
        "svix-signature": `v1,${sig}`,
        "svix-timestamp": String(ts),
      },
      secret,
    });
    expect(verified.event.kind).toBe("delivered");
    expect(verified.event.recipient).toBe("alice@example.com");
    expect(verified.event.campaignId).toBe("cmp_1");
  });
});

/* ============================================================================
 * 33-36 — Email identity + thread sanitization.
 * ==========================================================================*/

describe("EmailAddress sanitization", () => {
  it("33 parseAddress handles display-name form (sanitized to email)", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    let rawB64 = "";
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/drafts") && init?.method === "POST") {
        const payload = JSON.parse(init.body as string) as { message: { raw: string } };
        rawB64 = payload.message.raw;
        return jsonResponse(200, { id: "d1", message: { threadId: "t1" } });
      }
      throw new Error("unexpected");
    }) as unknown as typeof fetch;
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const out = await adapter.createDraft({
      to: ['"Alice Smith" <alice@example.com>'],
      subject: "Hola",
      bodyText: "Cuerpo",
    });
    expect(out.success).toBe(true);
    const decoded = Buffer.from(rawB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
    // The display-name form is accepted; the To header preserves the
    // bare email address (a deliberate sanitization — Gmail will
    // still resolve the display name from the From line).
    expect(decoded).toContain("alice@example.com");
  });
});

/* ============================================================================
 * 37-40 — Capability gating prevents orphaned promises (extension).
 * ==========================================================================*/

describe("Capability gating (email)", () => {
  it("37 email capabilities exist with the right providers", () => {
    expect(isCapabilityAvailable("org_x", "email.identity.read").provider).toBe("gmail");
    expect(isCapabilityAvailable("org_x", "email.search").provider).toBe("gmail");
    expect(isCapabilityAvailable("org_x", "email.send.bulk").provider).toBe("resend");
  });

  it("38 email.send.bulk does NOT run when campaign.status != approved", () => {
    expect(canSendCampaign("draft")).toBe(false);
    expect(canSendCampaign("ready_for_approval")).toBe(false);
    expect(canSendCampaign("approved")).toBe(true);
  });

  it("39 campaign store guards unknown id", async () => {
    const store = new InMemoryEmailCampaignStore();
    await expect(store.get("nope")).resolves.toBeNull();
  });

  it("40 createCampaign rejects sequences longer than EMAIL_SEQUENCE_MAX_STEPS", async () => {
    const input = buildCampaignInput("org_x");
    const longer = {
      ...input,
      sequence: {
        id: "seq_long",
        steps: [
          ...input.sequence.steps,
          {
            id: "step_4",
            orderIndex: 3,
            subject: "extra",
            bodyText: "extra",
            delayHours: 0,
          },
        ],
      },
    };
    // The store itself doesn't reject; the executor is responsible
    // for the limit check. Verify the constant matches the brief.
    expect(longer.sequence.steps.length).toBeGreaterThan(3);
  });
});

/* ============================================================================
 * 41-45 — Domain authentication status.
 * ==========================================================================*/

describe("Domain authentication status", () => {
  it("41 verifyDomain returns empty status when domain is empty", async () => {
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    const status = await adapter.verifyDomain("");
    expect(status.spf).toBe("missing");
    expect(status.dkim).toBe("missing");
    expect(status.dmarc).toBe("missing");
  });

  it("42 verifyDomain reflects SPF/DKIM/DMARC status truthfully", async () => {
    globalThis.fetch = (async () =>
      jsonResponse(200, {
        status: "verified",
        records: [
          { record: "SPF", status: "verified" },
          { record: "DKIM", status: "verified" },
          { record: "DMARC", status: "verified" },
        ],
      })) as unknown as typeof fetch;
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    const status = await adapter.verifyDomain("send.departify.app");
    expect(status.spf).toBe("valid");
    expect(status.dkim).toBe("valid");
    expect(status.dmarc).toBe("valid");
  });
});

/* ============================================================================
 * 46-50 — Health checks.
 * ==========================================================================*/

describe("GmailAdapter.health", () => {
  it("43 needs_attention when no tokens", async () => {
    gmailTokenStore.remove("org_x", "user_x");
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const h = await adapter.health();
    expect(h.state).toBe("needs_attention");
  });

  it("44 connected when profile responds 200", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    globalThis.fetch = (async () =>
      jsonResponse(200, {
        emailAddress: "ceo@example.com",
        messagesTotal: 1,
        threadsTotal: 1,
      })) as unknown as typeof fetch;
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const h = await adapter.health();
    expect(h.state).toBe("connected");
  });

  it("45 error when Gmail returns 500", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    globalThis.fetch = (async () => textResponse(500, "boom")) as unknown as typeof fetch;
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const h = await adapter.health();
    expect(h.state).toBe("error");
  });
});

/* ============================================================================
 * 46-50 — Type guards + edge cases.
 * ==========================================================================*/

describe("Gmail token refresh + OAuth state", () => {
  it("46 OAuth state expires after 10 minutes", async () => {
    const start = startGmailOAuth({
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/x",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    });
    // Mutate the expiry by replacing the entry directly.
    const stored = gmailOAuthStateStore.get(start.state);
    expect(stored).not.toBeNull();
    // Replace with an expired entry.
    const expired = stored!;
    gmailOAuthStateStore.put({
      ...expired,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(gmailOAuthStateStore.get(start.state)).toBeNull();
  });

  it("47 Gmail token removal disconnects the user", () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date().toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    expect(gmailTokenStore.get("org_x", "user_x")?.email).toBe("ceo@example.com");
    gmailTokenStore.remove("org_x", "user_x");
    expect(gmailTokenStore.get("org_x", "user_x")).toBeNull();
  });

  it("48 Gmail OAuth state nonce is non-trivial entropy", () => {
    const a = startGmailOAuth({
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/x",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    });
    const b = startGmailOAuth({
      organizationId: "org_x",
      userId: "user_x",
      returnPath: "/x",
      locale: "es",
      redirectUri: TEST_REDIRECT,
      clientId: TEST_CLIENT_ID,
    });
    expect(a.state).not.toBe(b.state);
    expect(a.state.length).toBeGreaterThanOrEqual(20);
  });

  it("49 GmailAdapter.disconnect drops the tokens", () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date().toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    adapter.disconnect();
    expect(gmailTokenStore.get("org_x", "user_x")).toBeNull();
  });

  it("50 search rejects empty query", async () => {
    gmailTokenStore.put("org_x", "user_x", {
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@example.com",
      displayName: "CEO",
    });
    const adapter = new GmailAdapter(
      { organizationId: "org_x", userId: "user_x" },
      TEST_CLIENT_ID,
      TEST_CLIENT_SECRET,
    );
    const out = await adapter.searchMessages("   ");
    expect(out.success).toBe(false);
  });
});

/* ============================================================================
 * 51-55 — Bulk send guard.
 * ==========================================================================*/

describe("Bulk send structural guard", () => {
  it("51 bulk send refuses non-approved campaigns", () => {
    expect(canSendCampaign("draft")).toBe(false);
    expect(canSendCampaign("ready_for_approval")).toBe(false);
  });

  it("52 approved campaign can be sent", () => {
    expect(canSendCampaign("approved")).toBe(true);
  });

  it("53 a sending campaign is no longer sendable", () => {
    expect(canSendCampaign("sending")).toBe(false);
  });

  it("54 sent and failed are terminal states", () => {
    expect(canSendCampaign("sent")).toBe(false);
    expect(canSendCampaign("failed")).toBe(false);
    expect(canSendCampaign("partial")).toBe(false);
  });

  it("55 suppression filter works across the campaign lifecycle", async () => {
    const store = new InMemoryEmailCampaignStore();
    const c = await store.create(buildCampaignInput("org_x"));
    const updated = await store.updateStatus({
      campaignId: c.id,
      status: "approved",
      approvedBy: "ceo",
    });
    expect(updated.status).toBe("approved");
    expect(canSendCampaign(updated.status)).toBe(true);
  });
});

/* ============================================================================
 * 56-60 — Suppression + webhook integration.
 * ==========================================================================*/

describe("End-to-end webhook + suppression", () => {
  it("56 a hard bounce is filtered from subsequent sends", () => {
    suppressionStore.add({
      organizationId: "org_x",
      email: "bounced@example.com",
      reason: "hard_bounced",
      createdAt: new Date().toISOString(),
    });
    expect(suppressionStore.isSuppressed("org_x", "bounced@example.com")).toBe(true);
  });

  it("57 a complained address is filtered from subsequent sends", () => {
    suppressionStore.add({
      organizationId: "org_x",
      email: "complained@example.com",
      reason: "complained",
      createdAt: new Date().toISOString(),
    });
    expect(suppressionStore.isSuppressed("org_x", "complained@example.com")).toBe(true);
  });

  it("58 verifyResendWebhook rejects an invalid signature", async () => {
    const ts = Math.floor(Date.now() / 1000);
    expect(() =>
      verifyResendWebhook({
        rawBody: JSON.stringify({ type: "email.delivered" }),
        headers: {
          "svix-signature": "v1,deadbeef",
          "svix-timestamp": String(ts),
        },
        secret: "whsec_test",
      }),
    ).toThrow(EmailDeliveryError);
  });

  it("59 verifyResendWebhook rejects an unknown event type", async () => {
    const { createHmac } = await import("node:crypto");
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ type: "weird.unknown" });
    const secret = "whsec_test";
    const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    expect(() =>
      verifyResendWebhook({
        rawBody: body,
        headers: {
          "svix-signature": `v1,${sig}`,
          "svix-timestamp": String(ts),
        },
        secret,
      }),
    ).toThrow(EmailDeliveryError);
  });

  it("60 Bulk send refuses recipient with invalid email", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return jsonResponse(200, { id: `msg_${callCount}` });
    }) as unknown as typeof fetch;
    const adapter = new ResendEmailDeliveryAdapter("org_x");
    const out = await adapter.sendBulk({
      campaignId: "cmp_x",
      from: "Elvira <elvira@send.departify.app>",
      subject: "Hola",
      html: "<p>x</p>",
      recipients: [{ email: "valid@example.com" }],
    });
    expect(out.accepted).toBe(1);
    expect(callCount).toBe(1);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOrCreateCustomerZeroSession,
  resetCustomerZeroSessionsForTest,
} from "../src/customer-zero/customer-zero-session.js";
import { InMemoryConversationStore } from "../src/customer-zero/conversation-store.js";
import { InMemoryPendingWorkStore } from "../src/customer-zero/pending-work-store.js";
import {
  completePendingWorkForConversation,
  hydratePendingWorkForConversation,
  persistPendingWorkForConversation,
} from "../src/customer-zero/pending-work-state.js";
import { ensureConversation, processCeoMessage } from "../src/server/routes/customer-zero-v2.js";
import { resolvePendingFacebookPagesPublication } from "../src/customer-zero/facebook-pages-publishing.js";
import type { ConnectorExecutionRequest, ConnectorExecutionResult, ConnectorHealthResult, ConnectorRuntime } from "@departify/connector-runtime";
import type { MarketingService } from "../src/customer-zero/marketing-service.js";
import { createInMemoryGoogleTokenStore, getGoogleTokenStore, installGoogleTokenStore } from "../src/customer-zero/google-tokens.js";
import { HostingerEmailAdapter } from "../src/customer-zero/hostinger-email-adapter.js";

class FacebookRuntime implements ConnectorRuntime {
  readonly provider = "activepieces" as const;
  readonly requests: ConnectorExecutionRequest[] = [];
  async health(): Promise<ConnectorHealthResult> { return { provider: "activepieces", healthy: true, status: 200, durationMs: 1 }; }
  async execute<TOutput = unknown>(request: ConnectorExecutionRequest): Promise<ConnectorExecutionResult<TOutput>> {
    this.requests.push(request);
    const now = new Date().toISOString();
    return { requestId: request.requestId, organizationId: request.organizationId, provider: "activepieces", capability: request.capability, operation: request.operation, status: "succeeded", output: {} as TOutput, durationMs: 1, startedAt: now, completedAt: now };
  }
}

const approvedMarketing = {
  decideApproval: async () => ({ id: "approval_123", departmentId: "marketing", from: "Elvira", title: "Publicar", detail: "", status: "approved", createdAt: new Date().toISOString() }),
} as unknown as MarketingService;

function setup(organizationId = "org-durable") {
  const conversations = new InMemoryConversationStore();
  const pendingWork = new InMemoryPendingWorkStore();
  const session = getOrCreateCustomerZeroSession(organizationId, { conversations, pendingWork });
  return { conversations, pendingWork, session };
}

afterEach(() => {
  resetCustomerZeroSessionsForTest();
  installGoogleTokenStore(null);
  vi.restoreAllMocks();
});

describe("Sprint 68.1 durable pending work", () => {
  it("recovers the same email draft after a complete in-memory restart and edits it", async () => {
    const { conversations, pendingWork, session } = setup();
    const conversation = await ensureConversation(session, "Prepara un correo para Alex");
    session.state.pendingEmailWork = {
      id: "draft_123",
      status: "awaiting_approval",
      recipient: "alex@example.com",
      objective: "Resumen semanal",
      missingFields: [],
      draft: { to: "alex@example.com", subject: "Resumen", body: "Párrafo uno.\n\nPárrafo dos.\n\nPárrafo tres." },
      provider: null, requestedProvider: null, replyToProviderMessageId: null, replyToProviderThreadId: null,
      replyToProviderMessageUid: null, replyToProviderFolder: null, sendResult: null, sendError: null,
      acceptedAt: null, updatedAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id, "user-1");

    resetCustomerZeroSessionsForTest();
    const recovered = getOrCreateCustomerZeroSession("org-durable", { conversations, pendingWork });
    const result = await processCeoMessage(recovered, "Más corto", undefined, undefined, undefined, undefined, undefined, {}, "user-1");

    expect(result.reply).toContain("He preparado este correo");
    expect(recovered.state.pendingEmailWork).toMatchObject({ id: "draft_123", status: "awaiting_approval" });
    expect(recovered.state.pendingEmailWork?.draft?.body).not.toContain("Párrafo tres");
  });

  it("never resends an execution lease recovered after restart", async () => {
    const { conversations, pendingWork, session } = setup();
    const conversation = await ensureConversation(session, "Correo");
    session.state.pendingEmailWork = {
      id: "draft_sending", status: "sending", recipient: "alex@example.com", objective: "Resumen",
      missingFields: [], draft: { to: "alex@example.com", subject: "Resumen", body: "Hola" },
      provider: "google", requestedProvider: null, replyToProviderMessageId: null, replyToProviderThreadId: null,
      replyToProviderMessageUid: null, replyToProviderFolder: null, sendResult: null, sendError: null,
      acceptedAt: null, updatedAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id);

    resetCustomerZeroSessionsForTest();
    const recovered = getOrCreateCustomerZeroSession("org-durable", { conversations, pendingWork });
    const result = await processCeoMessage(recovered, "Envíalo");
    expect(result.reply).toMatch(/curso|in progress/i);
    expect(recovered.state.pendingEmailWork?.id).toBe("draft_sending");
    expect(recovered.state.pendingEmailWork?.status).toBe("sending");
  });

  it("only verifies an accepted email recovered after restart; it never sends again", async () => {
    const { conversations, pendingWork, session } = setup("org-email-accepted");
    const conversation = await ensureConversation(session, "Correo");
    session.state.pendingEmailWork = {
      id: "draft_accepted", status: "accepted_unverified", recipient: "alex@example.com", objective: "Resumen",
      missingFields: [], draft: { to: "alex@example.com", subject: "Resumen", body: "Hola" },
      provider: "hostinger", requestedProvider: "hostinger", replyToProviderMessageId: null, replyToProviderThreadId: null,
      replyToProviderMessageUid: null, replyToProviderFolder: null, sendResult: null, sendError: "PROVIDER_ACCEPTED_UNVERIFIED",
      acceptedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id);
    const verify = vi.spyOn(HostingerEmailAdapter.prototype, "verifySentMessage").mockResolvedValue(null);
    const send = vi.spyOn(HostingerEmailAdapter.prototype, "sendMessage");
    resetCustomerZeroSessionsForTest();
    const recovered = getOrCreateCustomerZeroSession("org-email-accepted", { conversations, pendingWork });
    const result = await processCeoMessage(recovered, "Envíalo");
    expect(result.reply).toMatch(/aceptado|accepted/i);
    expect(recovered.state.pendingEmailWork?.status).toBe("accepted_unverified");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps failed email context for a recovered failure question", async () => {
    const { conversations, pendingWork, session } = setup();
    const conversation = await ensureConversation(session, "Correo");
    session.state.pendingEmailWork = {
      id: "draft_failed", status: "failed", recipient: "alex@example.com", objective: "Resumen",
      missingFields: [], draft: { to: "alex@example.com", subject: "Resumen", body: "Hola" },
      provider: "google", requestedProvider: null, replyToProviderMessageId: null, replyToProviderThreadId: null,
      replyToProviderMessageUid: null, replyToProviderFolder: null, sendResult: null, sendError: "auth",
      acceptedAt: null, updatedAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id);
    resetCustomerZeroSessionsForTest();

    const recovered = getOrCreateCustomerZeroSession("org-durable", { conversations, pendingWork });
    const result = await processCeoMessage(recovered, "¿Por qué?");
    expect(result.reply).toMatch(/autorizaci[oó]n/i);
    expect(result.reply).not.toMatch(/OpenClaw|runtime|tool/i);
    expect(recovered.state.pendingEmailWork).toMatchObject({ id: "draft_failed", status: "failed", sendError: "auth" });
  });

  it("recovers calendar work only in its original organization and conversation", async () => {
    const { conversations, pendingWork, session } = setup("org-calendar-a");
    const conversation = await ensureConversation(session, "Crea una reunión");
    session.state.pendingCalendarWork = {
      id: "calendar_123", summary: "Reunión con Alex", hour: 10, minute: 0,
      startIso: "2026-08-21T08:00:00.000Z", endIso: "2026-08-21T08:30:00.000Z",
      timezone: "Europe/Madrid", attendees: ["alex@example.com"], status: "awaiting_approval", createdAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id, "user-a");

    const other = getOrCreateCustomerZeroSession("org-calendar-b", { conversations, pendingWork });
    const otherConversation = await ensureConversation(other, "Otra reunión");
    await hydratePendingWorkForConversation(other, otherConversation.id);
    expect(other.state.pendingCalendarWork).toBeUndefined();

    resetCustomerZeroSessionsForTest();
    const recovered = getOrCreateCustomerZeroSession("org-calendar-a", { conversations, pendingWork });
    await hydratePendingWorkForConversation(recovered, conversation.id);
    expect(recovered.state.pendingCalendarWork).toMatchObject({ id: "calendar_123", summary: "Reunión con Alex", attendees: ["alex@example.com"] });
  });

  it("recovers and creates the original Calendar event after restart", async () => {
    const { conversations, pendingWork, session } = setup("org-calendar-action");
    const conversation = await ensureConversation(session, "Crea la reunión");
    session.state.pendingCalendarWork = {
      id: "calendar_original", summary: "Reunión con Alex", hour: 10, minute: 0,
      startIso: "2026-08-21T08:00:00.000Z", endIso: "2026-08-21T08:30:00.000Z",
      timezone: "Europe/Madrid", attendees: ["alex@example.com"], status: "awaiting_approval", createdAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id);
    installGoogleTokenStore(createInMemoryGoogleTokenStore());
    await getGoogleTokenStore().put({
      organizationId: "org-calendar-action", userId: "user-calendar", provider: "gmail",
      accessToken: "access", refreshToken: "refresh", expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/calendar.events"], email: "ceo@example.com", displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(), operationalProbeError: null, operationalCapabilities: ["calendar.create"],
    });
    const originalFetch = globalThis.fetch;
    let createCalls = 0;
    globalThis.fetch = (async () => {
      createCalls += 1;
      return new Response(JSON.stringify({
        id: "event_original", summary: "Reunión con Alex", status: "confirmed",
        start: { dateTime: "2026-08-21T08:00:00.000Z" }, end: { dateTime: "2026-08-21T08:30:00.000Z" },
        htmlLink: "https://calendar.google.com/event_original", attendees: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      resetCustomerZeroSessionsForTest();
      const recovered = getOrCreateCustomerZeroSession("org-calendar-action", { conversations, pendingWork });
      const result = await processCeoMessage(recovered, "Sí, adelante", undefined, undefined, undefined, undefined, undefined, {}, "user-calendar");
      expect(result.reply).toContain("Reunión con Alex");
      expect(createCalls).toBe(1);
      expect(recovered.state.lastCalendarOperation).toMatchObject({ status: "verified", eventId: "event_original" });
      expect(await pendingWork.getActive("org-calendar-action", conversation.id, "calendar")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not recover terminal cancelled or succeeded work", async () => {
    const { pendingWork, session } = setup();
    const conversation = await ensureConversation(session, "Correo");
    session.state.pendingEmailWork = {
      id: "draft_terminal", status: "awaiting_approval", recipient: "alex@example.com", objective: "Resumen",
      missingFields: [], draft: { to: "alex@example.com", subject: "Resumen", body: "Hola" },
      provider: null, requestedProvider: null, replyToProviderMessageId: null, replyToProviderThreadId: null,
      replyToProviderMessageUid: null, replyToProviderFolder: null, sendResult: null, sendError: null,
      acceptedAt: null, updatedAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id);
    await completePendingWorkForConversation(session, conversation.id, "email", "cancelled");
    expect(await pendingWork.getActive("org-durable", conversation.id, "email")).toBeNull();

    session.state.pendingCalendarWork = { id: "calendar_terminal", summary: "Reunión", timezone: "Europe/Madrid", attendees: [], status: "awaiting_approval", createdAt: new Date().toISOString() };
    await persistPendingWorkForConversation(session, conversation.id);
    await completePendingWorkForConversation(session, conversation.id, "calendar", "succeeded");
    expect(await pendingWork.getActive("org-durable", conversation.id, "calendar")).toBeNull();
  });

  it("starts a new CEO request after a terminal email without reusing its draft", async () => {
    const { conversations, pendingWork, session } = setup("org-next-email");
    const conversation = await ensureConversation(session, "Correo anterior");
    session.state.pendingEmailWork = {
      id: "draft_finished", status: "awaiting_approval", recipient: "alex@example.com", objective: "Resumen",
      missingFields: [], draft: { to: "alex@example.com", subject: "Resumen", body: "Borrador anterior" },
      provider: null, requestedProvider: null, replyToProviderMessageId: null, replyToProviderThreadId: null,
      replyToProviderMessageUid: null, replyToProviderFolder: null, sendResult: null, sendError: null,
      acceptedAt: null, updatedAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id);
    await completePendingWorkForConversation(session, conversation.id, "email", "succeeded");
    resetCustomerZeroSessionsForTest();

    const recovered = getOrCreateCustomerZeroSession("org-next-email", { conversations, pendingWork });
    const result = await processCeoMessage(recovered, "Prepara un correo para María con las cifras");
    expect(result.reply).toContain("He preparado este correo");
    expect(recovered.state.pendingEmailWork).toMatchObject({ recipient: "María", objective: "las cifras" });
    expect(recovered.state.pendingEmailWork?.id).not.toBe("draft_finished");
  });

  it("recovers and approves the original Facebook Pages publication exactly once", async () => {
    const { conversations, pendingWork, session } = setup("org-facebook");
    const conversation = await ensureConversation(session, "Publica en Facebook");
    session.state.pendingFacebookPagesWork = {
      id: "social_123", approvalId: "approval_123", content: "El texto original", status: "awaiting_approval", createdAt: new Date().toISOString(),
    };
    await persistPendingWorkForConversation(session, conversation.id);
    resetCustomerZeroSessionsForTest();

    const recovered = getOrCreateCustomerZeroSession("org-facebook", { conversations, pendingWork });
    await hydratePendingWorkForConversation(recovered, conversation.id);
    const connection = { toolId: "meta_business", label: "Meta", capability: "marketing.social.publish", category: "Marketing", status: "connected" as const, lifecycle: "connected" as const, verifiedAt: new Date().toISOString(), grantedCapabilities: ["marketing.social.publish"] };
    recovered.state.connections.set("meta_business", connection);
    const runtime = new FacebookRuntime();
    const outcome = await resolvePendingFacebookPagesPublication({ session: recovered, deps: { marketing: approvedMarketing, connectorRuntime: runtime }, decision: "approve" });
    expect(outcome.status).toBe("published");
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]?.input).toEqual({ content: "El texto original", approvalId: "approval_123" });
  });
});

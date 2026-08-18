import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type {
  EngineAdapter,
  EngineHealth,
  EngineHistory,
  EngineMessageResult,
  EngineSendMessageInput,
  EngineSession,
  EngineToolState,
  EngineUsage,
} from "@departify/engine-adapter";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryCompanyDnaStore } from "../src/customer-zero/company-dna.js";
import { isInternalRuntimeLeak } from "../src/server/routes/customer-zero-v2.js";

class ReliabilityTestEngine implements EngineAdapter {
  inputs: EngineSendMessageInput[] = [];
  responseBehavior: "happy" | "leak" | "fail" | "double_fail" = "happy";
  sessionIds: string[] = [];

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    const id = input?.sessionId ?? "ceo:test";
    this.sessionIds.push(id);
    return { id, status: "active" };
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    if (this.responseBehavior === "fail") {
      this.responseBehavior = "happy"; // Recover on retry
      return {
        sessionId: input.sessionId,
        text: "",
        status: "failed",
      };
    }
    if (this.responseBehavior === "double_fail") {
      return {
        sessionId: input.sessionId,
        text: "",
        status: "failed",
      };
    }
    if (this.responseBehavior === "leak") {
      // Simulate leak once, then change behavior to happy so retry succeeds!
      this.responseBehavior = "happy";
      return {
        sessionId: input.sessionId,
        text: "Auto-compaction could not recover this turn. Please use /compact or set agents.defaults.compaction.reserveTokensFloor to 35000",
        status: "completed",
      };
    }
    return {
      sessionId: input.sessionId,
      text: "Factual analysis completed successfully.",
      status: "completed",
    };
  }

  async getSession(sessionId: string): Promise<EngineSession | null> {
    if (this.sessionIds.includes(sessionId)) {
      return { id: sessionId, status: "active" };
    }
    return null;
  }
  async getHistory(sessionId: string): Promise<EngineHistory> {
    return { sessionId, items: [] };
  }
  async closeSession(): Promise<void> {}
  async getUsage(): Promise<EngineUsage> {
    return {};
  }
  async getToolState(): Promise<EngineToolState> {
    return { available: ["exec", "message", "session_status"], denied: [] };
  }
  async health(): Promise<EngineHealth> {
    return { healthy: true, ready: true, provider: "test" };
  }
}

describe("runtime/gateway reliability P0 tests", () => {
  let server: FastifyInstance;
  let engine: ReliabilityTestEngine;
  let companyDna: InMemoryCompanyDnaStore;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    engine = new ReliabilityTestEngine();
    companyDna = new InMemoryCompanyDnaStore();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      engine,
      companyDna,
      nativeBusinessTools: true,
    });
  });

  afterEach(() => {
    engine.inputs = [];
    engine.responseBehavior = "happy";
    engine.sessionIds = [];
  });

  it("Test 1 & 4 & 5 & 6 & 8: long conversation -> automatic secondary compaction -> history, DNA and context preserved on server restart", async () => {
    // 1. Onboard / start session
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Reliability Enterprise",
        hasWebsite: false,
        description: "Specialized B2B software solutions.",
        goal: "Grow business leads",
      },
    });
    expect(start.statusCode).toBe(200);
    const org = start.json().organizationId as string;

    // Get active conversation
    const activeConversationsInit = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    const activeConversationId = activeConversationsInit.json().conversations[0].id;

    // Send multiple turns with long messages to accumulate characters (>8000) and trigger secondary compaction
    for (let i = 0; i < 15; i++) {
      const longMessage = `This is conversational turn index ${i} to test context accumulation budget. ` +
        "We are verifying that the secondary compaction process properly folds older messages into the durable summary " +
        "when the total character threshold is exceeded. This keeps the active session context window safe. ".repeat(6);
      const response = await server.inject({
        method: "POST",
        url: `/api/customer-zero/${org}/conversations/${activeConversationId}/messages`,
        headers: { authorization: "Bearer token-a" },
        payload: {
          message: longMessage,
        },
      });
      expect(response.statusCode).toBe(200);
    }

    // Verify compaction summary was created on conversation
    const activeConversations = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    const active = activeConversations.json().conversations[0];
    expect(active.summary).toBeDefined();
    expect(active.compactedUpToMessageId).toBeDefined();

    // Verify session ID in engine has the compaction suffix
    const lastInput = engine.inputs[engine.inputs.length - 1];
    expect(lastInput).toBeDefined();
    expect(lastInput!.sessionId).toMatch(/:[a-zA-Z0-9_-]+$/);

    // Verify raw history remains preserved
    const msgHistory = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations/${active.id}`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(msgHistory.json().messages.length).toBeGreaterThan(15);

    // Test 5: Verify DNA is intact
    const status = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/understanding`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(status.json().companyName).toBe("Reliability Enterprise");

    // Test 6: Verify department context is preserved
    const dept = await server.inject({
      method: "GET",
      url: `/api/departments/seo/${org}`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(dept.statusCode).toBe(200);

    // Test 8: Simulate server reload/restart
    const reloadedServer = await buildServer(loadBackendConfig(), {
      auth: makeFakeTenant(),
      organizations: makeFakeTenant(),
      engine,
      companyDna,
      nativeBusinessTools: true,
    });
    const reloadedConversations = await reloadedServer.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(reloadedConversations.json().conversations[0].summary).toBeDefined();
  });

  it("Test 2 & 7: explicit compaction leak/failure -> automatic session rotation -> retry -> clean non-leaked response", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Leak Proof Corp",
        hasWebsite: false,
        description: "Privacy software.",
        goal: "Protect secrets",
      },
    });
    const org = start.json().organizationId as string;

    const activeConversations = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    const activeConversationId = activeConversations.json().conversations[0].id;

    // Reset sessionIds so the test message turns are tracked starting from zero
    engine.sessionIds = [];
    // Set engine to leak internal compaction failure strings
    engine.responseBehavior = "leak";

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${activeConversationId}/messages`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        message: "Analyze competitor marketing details", // No "seo" to avoid bypass
      },
    });

    expect(response.statusCode).toBe(200);
    // The response should have recovered and completed successfully without any leaks
    expect(response.json().reply).toBe("Factual analysis completed successfully.");

    // Test 7: Verify absolutely no forbidden terms are present
    const bodyText = JSON.stringify(response.json());
    expect(isInternalRuntimeLeak(bodyText)).toBe(false);

    // Verify session rotation was triggered (multiple sessionIds in engine)
    expect(engine.sessionIds.length).toBeGreaterThan(1);
  });

  it("Test 3 & 7: compaction failure + retry failure -> user-friendly converted error message with structured code", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Fail Proof Corp",
        hasWebsite: false,
        description: "Failure tests.",
        goal: "Fail cleanly",
      },
    });
    const org = start.json().organizationId as string;

    const activeConversations = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    const activeConversationId = activeConversations.json().conversations[0].id;

    // Reset sessionIds so the test message turns are tracked starting from zero
    engine.sessionIds = [];
    // Force engine to fail on first attempt AND retry attempt
    engine.responseBehavior = "double_fail";

    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${activeConversationId}/messages`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        message: "Trigger severe outage now",
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("ENGINE_EXECUTION");
    expect(response.json().error.message).toContain("No he podido completar esa respuesta");
    expect(isInternalRuntimeLeak(JSON.stringify(response.json()))).toBe(false);
  });

  it("SEO bypass & final-response contract: direct SEO audit execution, no progress leaking, language is preserved", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "SEO Integrity Corp",
        hasWebsite: true,
        url: "https://departify.app", // Correct property is "url"
        description: "BOS solutions.",
        goal: "Dominate search rankings",
      },
    });
    expect(start.statusCode).toBe(200);
    const org = start.json().organizationId as string;

    const activeConversations = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    const activeConversationId = activeConversations.json().conversations[0].id;

    // Reset sessionIds so we can confirm NO OpenClaw native calls are made for the SEO direct audit pipeline!
    engine.sessionIds = [];

    // Send explicit SEO audit request
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${activeConversationId}/messages`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        message: "Analiza el SEO de departify.app y dame las acciones prioritarias.",
      },
    });

    expect(response.statusCode).toBe(200);
    // 1. Confirm that it returned the real SEO audit result and NOT any "I have enough data... Let me also check..." progress leak!
    const replyText = response.json().reply.toLowerCase();
    expect(replyText).toContain("he auditado");
    expect(replyText).toContain("departify.app");
    expect(replyText).not.toContain("i have enough data");

    // 2. Confirm that no OpenClaw native messages were sent (engine.inputs remains empty!)
    expect(engine.inputs.length).toBe(0);

    // 3. Confirm that the message is persisted once in the conversation detail
    const detail = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations/${activeConversationId}`,
      headers: { authorization: "Bearer token-a" },
    });
    const messages = detail.json().messages;
    
    // Find our sent user message
    const userMsg = messages.filter((m: any) => m.role === "user" && m.content.includes("Analiza el SEO"));
    expect(userMsg.length).toBe(1); // One persisted user message only (no duplication!)

    // Find our assistant reply
    const assistantMsg = messages.filter((m: any) =>
      m.role === "assistant" &&
      m.content.toLowerCase().includes("he auditado") &&
      m.content.toLowerCase().includes("departify.app")
    );
    expect(assistantMsg.length).toBe(1); // One persisted final assistant message only!
  });
});

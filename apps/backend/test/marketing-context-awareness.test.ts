import { describe, expect, it } from "vitest";
import type { EngineAdapter } from "@departify/engine-adapter";
import { MarketingService } from "../src/customer-zero/marketing-service.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";

class ContextCapturingEngine implements EngineAdapter {
  readonly messages: string[] = [];

  async createSession(input?: { sessionId?: string }) {
    return { id: input?.sessionId ?? "marketing-test", status: "active" as const };
  }

  async sendMessage(input: { sessionId: string; message: string }) {
    this.messages.push(input.message);
    return {
      sessionId: input.sessionId,
      text: "He revisado el estado de las conexiones.",
      status: "completed" as const,
      durationMs: 1,
    };
  }

  async getSession() {
    return { id: "marketing-test", status: "active" as const };
  }
  async getHistory() { return { sessionId: "marketing-test", items: [] }; }
  async closeSession() {}
  async getUsage() { return { provider: "test", model: "test" }; }
  async getToolState() { return { available: [], denied: [] }; }
  async health() { return { healthy: true, ready: true, provider: "test" }; }
}

describe("Marketing context awareness — durable tenant state", () => {
  it("projects a connected Facebook Pages grant into the legacy Elvira context", async () => {
    const engine = new ContextCapturingEngine();
    const toolState = new InMemoryToolStateStore();
    await toolState.upsert({
      organizationId: "org_context",
      toolId: "meta_business",
      label: "Meta Business",
      declared: true,
      status: "connected",
      verifiedAt: "2026-01-01T00:00:00.000Z",
      grantedCapabilities: ["marketing.social.read", "marketing.social.publish"],
    });

    const service = new MarketingService({ engine, toolState });
    await service.talkToElvira({
      organizationId: "org_context",
      message: "¿Tengo Facebook conectado y puedes publicar?",
      locale: "es",
    });

    const context = engine.messages[0] ?? "";
    expect(context).toContain("Facebook Pages");
    expect(context).toContain("HERRAMIENTAS DE NEGOCIO CONECTADAS:");
    expect(context).toContain("preparar una publicación para Facebook Pages");
    expect(context).not.toMatch(/Activepieces|ConnectorRuntime|OpenClaw|MCP|access_token|refresh_token/i);
  });

  it("removes the connected capability after the durable connection is disconnected", async () => {
    const engine = new ContextCapturingEngine();
    const toolState = new InMemoryToolStateStore();
    const base = {
      organizationId: "org_disconnect",
      toolId: "meta_business",
      label: "Meta Business",
      declared: true,
      verifiedAt: "2026-01-01T00:00:00.000Z",
      grantedCapabilities: ["marketing.social.publish"],
    } as const;
    await toolState.upsert({ ...base, status: "connected" });
    const service = new MarketingService({ engine, toolState });
    await service.talkToElvira({ organizationId: base.organizationId, message: "estado", locale: "es" });
    expect(engine.messages[0]).toContain("Facebook Pages: conectado");

    await toolState.upsert({ ...base, status: "needs_connection" });
    await service.talkToElvira({ organizationId: base.organizationId, message: "estado actualizado", locale: "es" });
    expect(engine.messages[1]).not.toContain("Facebook Pages: connected");
    expect(engine.messages[1]).not.toContain("HERRAMIENTAS DE NEGOCIO CONECTADAS:");
  });
});

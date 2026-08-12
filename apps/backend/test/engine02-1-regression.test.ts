import { describe, expect, it } from "vitest";
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
import { buildRuntimeCapabilityManifest } from "../src/customer-zero/capability-manifest.js";
import { runRuntimeBusinessTurn } from "../src/customer-zero/runtime-business-orchestrator.js";
import type { RuntimeBusinessContext } from "../src/customer-zero/department-context-compiler.js";

class SequenceEngine implements EngineAdapter {
  readonly inputs: EngineSendMessageInput[] = [];

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    const call = this.inputs.length === 1
      ? '<departify_tool_call>{"name":"departify.email.list","arguments":{"limit":1}}</departify_tool_call>'
      : this.inputs.length === 2
        ? '<departify_tool_call>{"name":"departify.calendar.list","arguments":{"range":"upcoming"}}</departify_tool_call>'
        : "Correo y calendario consultados.";
    return { sessionId: input.sessionId, status: "completed", text: call };
  }

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    return { id: input?.sessionId ?? "ceo:engine02-1", status: "active" };
  }
  async getSession(): Promise<EngineSession | null> { return null; }
  async getHistory(sessionId: string): Promise<EngineHistory> { return { sessionId, items: [] }; }
  async closeSession(): Promise<void> {}
  async getUsage(): Promise<EngineUsage> { return {}; }
  async getToolState(): Promise<EngineToolState> { return { available: [], denied: [] }; }
  async health(): Promise<EngineHealth> { return { healthy: true, ready: true }; }
}

function context(): RuntimeBusinessContext {
  return {
    version: 1,
    compiledAt: new Date().toISOString(),
    organization: { id: "org_engine02_1" },
    identity: { role: "ceo", locale: "es", timezone: "Europe/Madrid" },
    company: { products: [], customers: [] },
    connections: [],
    activeObjective: null,
    departments: [],
    capabilities: buildRuntimeCapabilityManifest([
      { toolId: "gmail", label: "Gmail", state: "connected", capabilities: ["email.read"] },
      { toolId: "google-calendar", label: "Calendar", state: "connected", capabilities: ["calendar.read"] },
    ]),
    currentOperation: null,
    activeWork: [],
    pendingApprovals: [],
    recentResults: [],
    recentActivity: [],
    recentConversation: [],
  };
}

describe("ENGINE 02.1 runtime tool loop", () => {
  it("executes two read tools and returns one composed response", async () => {
    const engine = new SequenceEngine();
    const selected: string[] = [];
    const result = await runRuntimeBusinessTurn({
      engine,
      sessionId: "ceo:engine02-1",
      organizationId: "org_engine02_1",
      message: "consulta mi ultimo mail y el calendario",
      context: context(),
      executeTool: async (call) => {
        selected.push(call.name);
        return { status: "success", operation: call.name, summary: `${call.name} ok` };
      },
    });

    expect(selected).toEqual(["departify.email.list", "departify.calendar.list"]);
    expect(result.toolCalls?.map((call) => call.name)).toEqual(selected);
    expect(result.text).toBe("Correo y calendario consultados.");
    expect(engine.inputs).toHaveLength(3);
    expect(engine.inputs[1]?.toolResult).toContain("departify.email.list");
    expect(engine.inputs[2]?.toolResult).toContain("departify.calendar.list");
  });

  it("bounds repeated tool selection instead of looping forever", async () => {
    const engine = new SequenceEngine();
    engine.sendMessage = async (input) => {
      engine.inputs.push(input);
      return {
        sessionId: input.sessionId,
        status: "completed",
        text: '<departify_tool_call>{"name":"departify.email.list","arguments":{"limit":1}}</departify_tool_call>',
      };
    };
    const result = await runRuntimeBusinessTurn({
      engine,
      sessionId: "ceo:engine02-1",
      organizationId: "org_engine02_1",
      message: "consulta mi correo",
      context: context(),
      executeTool: async (call) => ({ status: "success", operation: call.name, summary: "ok" }),
    });
    expect(engine.inputs.length).toBeLessThanOrEqual(2);
    expect(result.toolCalls).toHaveLength(1);
  });
});

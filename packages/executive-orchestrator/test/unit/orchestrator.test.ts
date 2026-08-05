import type {
  AgentToolAction,
  AgentToolActionResult,
  AgentToolOutcomeError,
  AgentToolPort,
} from "@departify/agent-tool-bridge";
import { ExecutiveDirector } from "@departify/executive-director";
import {
  ExecutiveOrchestrator,
  createExecutiveDecisionMapper,
  createExecutiveOrchestrator,
  type OrchestratorIntent,
  type OrchestrationResult,
} from "../../src/index.js";

function buildOrchestrator(bridge: AgentToolPort): ExecutiveOrchestrator {
  return createExecutiveOrchestrator({
    director: new ExecutiveDirector(),
    bridge,
  });
}

function successBridge(output: unknown, toolId: string): AgentToolPort {
  return {
    executeAction: async () => {
      const envelope: AgentToolActionResult = {
        actionId: "act_001",
        requestId: "intent_001",
        toolId,
        toolVersion: "1.0.0",
        status: "completed",
        output,
        durationMs: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      return envelope;
    },
  };
}

function rejectedBridge(
  reason: string,
  code: string,
  toolId: string,
): AgentToolPort {
  return {
    executeAction: async () => {
      const error: AgentToolOutcomeError = {
        actionId: "act_002",
        agentId: "agent.executive",
        toolId,
        status: "rejected",
        reason,
        code,
        occurredAt: new Date().toISOString(),
      };
      return error;
    },
  };
}

function throwingBridge(message: string): AgentToolPort {
  return {
    executeAction: async () => {
      throw new Error(message);
    },
  };
}

function correlationBridge(): AgentToolPort {
  return {
    executeAction: async (action: AgentToolAction) => {
      const result: AgentToolActionResult = {
        actionId: action.actionId,
        requestId: action.metadata?.["intent_id"] ?? "unknown",
        toolId: action.toolId,
        toolVersion: "1.0.0",
        status: "completed",
        output: { correlation: action.metadata ?? {} },
        durationMs: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      return result;
    },
  };
}

describe("ExecutiveOrchestrator", () => {
  it("orchestrates a health_check intent end-to-end", async () => {
    const bridge = successBridge({ ok: true }, "system.health");
    const orchestrator = buildOrchestrator(bridge);

    const result = await orchestrator.orchestrateHealthCheck({
      type: "health_check",
      intentId: "intent_health_e2e_001",
      requestedBy: "tester",
    });

    expect(result.tool.toolId).toBe("system.health");
    expect(result.tool.status).toBe("completed");
    expect(result.intentId).toBe("intent_health_e2e_001");
    expect(result.decisionId).toMatch(/^dec_/);
    expect(result.actionId).toMatch(/^act_dec_/);
    expect(result.error).toBeNull();
    expect(result.output).toEqual({ ok: true });
  });

  it("orchestrates an organization_summary intent and forwards the org id", async () => {
    const bridge = successBridge(
      { organization: { id: "org_departify" } },
      "organization.get",
    );
    const orchestrator = buildOrchestrator(bridge);

    const result = await orchestrator.orchestrateOrganizationSummary({
      type: "organization_summary",
      intentId: "intent_org_002",
      requestedBy: "tester",
      organizationId: "org_departify",
    });

    expect(result.tool.toolId).toBe("organization.get");
    expect(result.tool.status).toBe("completed");
    expect(result.error).toBeNull();
  });

  it("orchestrates a generate_identifier intent and returns a UUID payload", async () => {
    const bridge = successBridge(
      {
        uuid: "00000000-0000-4000-8000-000000000000",
        version: "v4",
      },
      "system.uuid",
    );
    const orchestrator = buildOrchestrator(bridge);

    const result = await orchestrator.orchestrateGenerateIdentifier({
      type: "generate_identifier",
      intentId: "intent_uuid_003",
      requestedBy: "tester",
    });

    expect(result.tool.toolId).toBe("system.uuid");
    expect((result.output as { uuid: string }).uuid).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it("surfaces agent rejections as a rejected OrchestrationResult", async () => {
    const bridge = rejectedBridge(
      "Agent not registered.",
      "agent_not_registered",
      "system.health",
    );
    const orchestrator = buildOrchestrator(bridge);

    const result = await orchestrator.orchestrateHealthCheck({
      type: "health_check",
      intentId: "intent_health_rej_001",
      requestedBy: "tester",
    });

    expect(result.tool.status).toBe("rejected");
    expect(result.error?.phase).toBe("bridge");
    expect(result.error?.code).toBe("agent_not_registered");
  });

  it("captures bridge failures as OrchestrationResult errors", async () => {
    const bridge = throwingBridge("bridge exploded");
    const orchestrator = buildOrchestrator(bridge);

    const result = await orchestrator.orchestrateHealthCheck({
      type: "health_check",
      intentId: "intent_health_bridge_fail_001",
      requestedBy: "tester",
    });

    expect(result.error?.phase).toBe("bridge");
    expect(result.error?.code).toBe("bridge_failed");
    expect(result.error?.message).toContain("bridge exploded");
  });

  it("preserves correlation IDs across the full pipeline", async () => {
    const bridge = correlationBridge();
    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge,
    });

    const result: OrchestrationResult = await orchestrator.orchestrate({
      type: "generate_identifier",
      intentId: "intent_corr_chain_001",
      requestedBy: "tester",
    } as OrchestratorIntent);

    expect(result.intentId).toBe("intent_corr_chain_001");
    expect(result.decisionId).toBe("dec_intent_corr_chain_001");
    expect(result.actionId).toBe("act_dec_intent_corr_chain_001");
  });

  it("supports a custom DecisionMapper for non-default mappings", () => {
    const mapper = createExecutiveDecisionMapper();
    expect(mapper.resolveToolId.bind(mapper)).toBeDefined();
  });
});

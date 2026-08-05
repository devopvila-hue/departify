import {
  createExecutiveDecisionMapper,
  ExecutiveDecisionMapper,
  type OrchestratorIntent,
} from "../../src/index.js";

describe("ExecutiveDecisionMapper", () => {
  it("adapts a health_check intent to an assign_task Executive Intent", () => {
    const mapper = createExecutiveDecisionMapper();
    const intent: OrchestratorIntent = {
      type: "health_check",
      intentId: "intent_health_001",
      requestedBy: "tester",
    };

    const executiveIntent = mapper.toExecutiveIntent(intent);
    expect(executiveIntent.type).toBe("assign_task");
    expect(executiveIntent.intentId).toBe("intent_health_001");
    expect(executiveIntent.requestedBy).toBe("tester");
    expect(executiveIntent.taskId).toBe("tool:system.health");
    expect(executiveIntent.metadata?.["orchestrator_intent"]).toBe(
      "health_check",
    );
    expect(executiveIntent.metadata?.["orchestrator_tool"]).toBe(
      "system.health",
    );
  });

  it("adapts an organization_summary intent and preserves the org id", () => {
    const mapper = createExecutiveDecisionMapper();
    const intent: OrchestratorIntent = {
      type: "organization_summary",
      intentId: "intent_org_001",
      requestedBy: "tester",
      organizationId: "org_departify",
    };

    const executiveIntent = mapper.toExecutiveIntent(intent);
    expect(executiveIntent.organizationId).toBe("org_departify");
    expect(executiveIntent.taskId).toBe("tool:organization.get");
    expect(executiveIntent.metadata?.["orchestrator_intent"]).toBe(
      "organization_summary",
    );
  });

  it("adapts a generate_identifier intent", () => {
    const mapper = createExecutiveDecisionMapper();
    const intent: OrchestratorIntent = {
      type: "generate_identifier",
      intentId: "intent_uuid_001",
      requestedBy: "tester",
    };

    const executiveIntent = mapper.toExecutiveIntent(intent);
    expect(executiveIntent.taskId).toBe("tool:system.uuid");
    expect(executiveIntent.metadata?.["orchestrator_tool"]).toBe("system.uuid");
  });

  it("produces AgentToolAction with correlation IDs from the decision", () => {
    const mapper = createExecutiveDecisionMapper();
    const intent: OrchestratorIntent = {
      type: "health_check",
      intentId: "intent_health_corr_001",
      requestedBy: "tester",
    };
    const decision = {
      decisionId: "dec_001",
      intentId: intent.intentId,
      intentType: "assign_task" as const,
      type: "coordinate_agent_runtime" as const,
      target: "agent_runtime" as const,
      action: "prepare_task_assignment",
      status: "created" as const,
      rationale: "test",
      createdAt: new Date(),
    };

    const action = mapper.toAgentToolAction(decision, intent, "agent.demo");

    expect(action.actionId).toBe("act_dec_001");
    expect(action.toolId).toBe("system.health");
    expect(action.agentId).toBe("agent.demo");
    expect(action.metadata?.["intent_id"]).toBe("intent_health_corr_001");
    expect(action.metadata?.["decision_id"]).toBe("dec_001");
    expect(action.metadata?.["action_id"]).toBe("act_dec_001");
  });

  it("preserves organization id when present on intent", () => {
    const mapper: ExecutiveDecisionMapper = new ExecutiveDecisionMapper();
    const intent: OrchestratorIntent = {
      type: "organization_summary",
      intentId: "intent_org_corr_001",
      requestedBy: "tester",
      organizationId: "org_demo",
    };
    const decision = {
      decisionId: "dec_002",
      intentId: intent.intentId,
      intentType: "assign_task" as const,
      type: "coordinate_agent_runtime" as const,
      target: "agent_runtime" as const,
      action: "prepare_task_assignment",
      status: "created" as const,
      rationale: "test",
      createdAt: new Date(),
    };

    const action = mapper.toAgentToolAction(decision, intent, "agent.demo");

    expect(action.organizationId).toBe("org_demo");
  });

  it("rejects unknown orchestrator intents at mapping time", () => {
    const mapper = new ExecutiveDecisionMapper({});
    const fakeIntent = {
      type: "health_check",
      intentId: "intent_x",
      requestedBy: "tester",
    };
    expect(() => mapper.resolveToolId(fakeIntent as never)).toThrow(
      /no tool mapping/i,
    );
  });
});

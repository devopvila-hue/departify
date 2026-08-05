import { AgentRegistry, agentRuntimeEventTypes } from "../src/index.js";

describe("agent runtime events", () => {
  it("defines canonical runtime event types", () => {
    expect(agentRuntimeEventTypes).toEqual([
      "agent.registered",
      "agent.started",
      "agent.ready",
      "agent.paused",
      "agent.stopped",
      "agent.failed",
      "agent.removed",
    ]);
  });

  it("records lifecycle events", () => {
    const registry = new AgentRegistry();
    registry.register({
      id: "agent_events_001",
      organizationId: "org_departify01",
      displayName: "Events Agent",
      role: "operations",
    });
    registry.activate("agent_events_001");
    registry.markReady("agent_events_001");
    registry.pause("agent_events_001");

    expect(registry.pullEvents().map((event) => event.type)).toEqual([
      "agent.registered",
      "agent.started",
      "agent.ready",
      "agent.paused",
    ]);
  });
});

import { agentEventTypes, type AgentDomainEvent } from "../src/index.js";

describe("Agent domain events", () => {
  it("declares the public event type registry", () => {
    expect(agentEventTypes).toEqual([
      "agent.created",
      "agent.activated",
      "agent.paused",
      "agent.resumed",
      "agent.disabled",
      "agent.deleted",
    ]);
  });

  it("supports strongly typed event payloads", () => {
    const event: AgentDomainEvent = {
      type: "agent.disabled",
      agentId: "agt_operations01",
      reason: "Compliance review",
      occurredAt: new Date("2026-08-05T00:00:00.000Z"),
    };

    expect(event.type).toBe("agent.disabled");
    expect(event.reason).toBe("Compliance review");
  });
});

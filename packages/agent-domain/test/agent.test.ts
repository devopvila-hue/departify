import {
  Agent,
  AgentDomainInvariantError,
  type AgentDomainEvent,
} from "../src/index.js";
import { agentInput } from "./fixtures.js";

describe("Agent aggregate root", () => {
  it("creates an agent and records an explicit domain event", () => {
    const agent = Agent.create(agentInput());

    expect(agent.getStatus()).toBe("created");
    expect(agent.toSnapshot()).toMatchObject({
      id: "agt_operations01",
      name: "Operations Coordinator",
      role: "operations-coordinator",
      departmentId: "dep_operations01",
      status: "created",
    });
    expect(agent.pullDomainEvents()).toEqual<AgentDomainEvent[]>([
      {
        type: "agent.created",
        agentId: "agt_operations01",
        agentName: "Operations Coordinator",
        departmentId: "dep_operations01",
        occurredAt: new Date("2026-08-05T00:00:00.000Z"),
      },
    ]);
  });

  it("supports controlled lifecycle transitions", () => {
    const agent = Agent.create(agentInput());
    agent.pullDomainEvents();

    agent.activate(new Date("2026-08-05T01:00:00.000Z"));
    agent.pause(new Date("2026-08-05T02:00:00.000Z"));
    agent.resume(new Date("2026-08-05T03:00:00.000Z"));
    agent.disable("Compliance review", new Date("2026-08-05T04:00:00.000Z"));
    agent.activate(new Date("2026-08-05T05:00:00.000Z"));

    expect(agent.getStatus()).toBe("active");
    expect(agent.pullDomainEvents().map((event) => event.type)).toEqual([
      "agent.activated",
      "agent.paused",
      "agent.resumed",
      "agent.disabled",
      "agent.activated",
    ]);
  });

  it("prevents implicit lifecycle transitions", () => {
    const agent = Agent.create(agentInput());

    expect(() => agent.pause()).toThrow(AgentDomainInvariantError);
    expect(agent.getStatus()).toBe("created");
  });

  it("protects deleted agents from mutation", () => {
    const agent = Agent.create(agentInput());

    agent.delete("Duplicate record");

    expect(agent.getStatus()).toBe("deleted");
    expect(() => agent.rename("New Name")).toThrow(AgentDomainInvariantError);
    expect(() => agent.activate()).toThrow(AgentDomainInvariantError);
  });

  it("updates mutable agent attributes before deletion", () => {
    const agent = Agent.create(agentInput());

    agent.rename("Finance Coordinator");
    agent.changeRole("finance-coordinator");
    agent.moveToDepartment("dep_finance001");
    agent.replaceCapabilities({ items: ["finance:read"] });
    agent.replacePermissions({
      items: [{ scope: "department", action: "read" }],
    });
    agent.updateProfile({
      summary: "Coordinates finance work within an assigned department.",
      responsibilities: ["Review finance queues"],
    });

    expect(agent.toSnapshot()).toMatchObject({
      name: "Finance Coordinator",
      role: "finance-coordinator",
      departmentId: "dep_finance001",
      capabilities: { items: ["finance:read"] },
    });
  });

  it("reconstitutes without replaying domain events", () => {
    const agent = Agent.reconstitute({
      ...Agent.create(agentInput()).toSnapshot(),
      status: "active",
    });

    expect(agent.getStatus()).toBe("active");
    expect(agent.pullDomainEvents()).toEqual([]);
  });
});

import {
  createExecutiveDecision,
  createExecutiveEvents,
  executiveEventTypes,
} from "../src/index.js";
import { assignTaskIntent, requestAgentIntent } from "./fixtures.js";

describe("Executive events", () => {
  it("declares the event registry", () => {
    expect(executiveEventTypes).toEqual([
      "decision.created",
      "task.assigned",
      "department.requested",
      "agent.requested",
    ]);
  });

  it("creates decision and task assignment events", () => {
    const intent = assignTaskIntent();
    const decision = createExecutiveDecision({
      intent,
      type: "coordinate_agent_runtime",
      target: "agent_runtime",
      action: "prepare_task_assignment",
      rationale: "Task assignment is runtime coordination.",
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(
      createExecutiveEvents(intent, decision).map((event) => event.type),
    ).toEqual(["decision.created", "task.assigned"]);
  });

  it("creates agent request events", () => {
    const intent = requestAgentIntent();
    const decision = createExecutiveDecision({
      intent,
      type: "record_operational_request",
      target: "executive_director",
      action: "record_agent_request",
      rationale: "Agent request is recorded.",
    });

    expect(createExecutiveEvents(intent, decision)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "agent.requested",
          agentName: "Finance Coordinator",
        }),
      ]),
    );
  });
});

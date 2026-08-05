import { ExecutiveDirector, orchestrationStages } from "../src/index.js";
import { createOrganizationIntent } from "./fixtures.js";

describe("ExecutiveDirector orchestration", () => {
  it("evaluates an intent into a decision, plan, and events", () => {
    const director = new ExecutiveDirector();
    const result = director.evaluate(
      createOrganizationIntent(),
      new Date("2026-08-05T00:00:00.000Z"),
    );

    expect(result.outcome.evaluation.accepted).toBe(true);
    expect(result.outcome.decision).toMatchObject({
      type: "coordinate_provisioning",
      target: "provisioning_engine",
      action: "prepare_organization_provisioning",
    });
    expect(result.plan.stages).toEqual(orchestrationStages);
    expect(result.events.map((event) => event.type)).toEqual([
      "decision.created",
    ]);
  });

  it("rejects invalid intents without executing coordination", () => {
    const director = new ExecutiveDirector();
    const result = director.evaluate({
      ...createOrganizationIntent(),
      organizationName: " ",
    });

    expect(result.outcome.evaluation.accepted).toBe(false);
    expect(result.outcome.decision).toMatchObject({
      type: "reject_intent",
      target: "executive_director",
      action: "reject_intent",
    });
  });
});

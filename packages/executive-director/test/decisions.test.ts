import {
  ExecutiveDirectorValidationError,
  assertExecutiveDecisionValid,
  createExecutiveDecision,
  executiveDecisionTargets,
  executiveDecisionTypes,
} from "../src/index.js";
import { createOrganizationIntent } from "./fixtures.js";

describe("Executive decisions", () => {
  it("declares decision types and targets", () => {
    expect(executiveDecisionTypes).toEqual([
      "coordinate_application_command",
      "coordinate_provisioning",
      "coordinate_agent_runtime",
      "record_operational_request",
      "reject_intent",
    ]);
    expect(executiveDecisionTargets).toEqual([
      "application_layer",
      "provisioning_engine",
      "agent_runtime",
      "executive_director",
    ]);
  });

  it("creates and validates decisions", () => {
    const decision = createExecutiveDecision({
      intent: createOrganizationIntent(),
      type: "coordinate_provisioning",
      target: "provisioning_engine",
      action: "prepare_organization_provisioning",
      rationale: "Organization creation is coordinated through provisioning.",
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      decisionId: "dec_int_create_org_001",
      intentType: "create_organization",
      status: "created",
    });
    expect(() => assertExecutiveDecisionValid(decision)).not.toThrow();
  });

  it("rejects malformed decisions", () => {
    expect(() =>
      createExecutiveDecision({
        intent: createOrganizationIntent(),
        type: "coordinate_provisioning",
        target: "provisioning_engine",
        action: " ",
        rationale: "Valid rationale",
      }),
    ).toThrow(ExecutiveDirectorValidationError);
  });
});

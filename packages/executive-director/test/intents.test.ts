import {
  ExecutiveDirectorValidationError,
  assertExecutiveIntentValid,
  executiveIntentTypes,
  validateExecutiveIntent,
} from "../src/index.js";
import { createOrganizationIntent } from "./fixtures.js";

describe("Executive intents", () => {
  it("declares the supported intent registry", () => {
    expect(executiveIntentTypes).toEqual([
      "create_organization",
      "activate_organization",
      "pause_organization",
      "resume_organization",
      "assign_task",
      "request_department",
      "request_agent",
    ]);
  });

  it("validates accepted intents", () => {
    expect(validateExecutiveIntent(createOrganizationIntent())).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects invalid task assignment intents", () => {
    const result = validateExecutiveIntent({
      type: "assign_task",
      intentId: "int_assign_task_001",
      requestedBy: "usr_admin001",
      organizationId: "org_departify01",
      taskId: "tsk_001",
      title: "Review onboarding checklist",
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "AssignTask requires a target agent or department.",
    );
    expect(() =>
      assertExecutiveIntentValid({
        ...createOrganizationIntent(),
        organizationName: " ",
      }),
    ).toThrow(ExecutiveDirectorValidationError);
  });
});

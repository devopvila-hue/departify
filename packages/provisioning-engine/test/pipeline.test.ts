import {
  getProvisioningStep,
  provisioningPipeline,
  provisioningPipelineStepIds,
} from "../src/index.js";

describe("provisioning pipeline", () => {
  it("defines the frozen provisioning phase order", () => {
    expect(provisioningPipelineStepIds).toEqual([
      "validate_request",
      "create_organization",
      "initialize_configuration",
      "prepare_storage",
      "prepare_memory",
      "prepare_rag",
      "register_plugins",
      "register_agent_runtime",
      "activate_executive_director",
      "mark_organization_ready",
    ]);
  });

  it("keeps every phase structural only in Sprint 5", () => {
    expect(
      provisioningPipeline.every((step) => step.implemented === false),
    ).toBe(true);
  });

  it("can look up a step by id", () => {
    expect(getProvisioningStep("prepare_memory")).toMatchObject({
      order: 5,
      requiredState: "in_progress",
    });
  });
});

import { describe, it, expect } from "vitest";
import type { LlmRouter } from "@departify/llm-router";
import {
  getOrCreateCustomerZeroSession,
  runDiscoveryForSession,
  runMarketingPreparationForSession,
} from "../src/customer-zero/customer-zero-session.js";
import type { LlmRuntime } from "../src/customer-zero/llm-runtime.js";

function stubLlm(): LlmRuntime {
  return {
    router: {
      chat: async () => ({ type: "chat", message: "stub reply" }),
      getDefaultProviderId: () => "openai",
    } as unknown as LlmRouter,
  };
}

/**
 * Integration test of the Customer Zero session composition (Sprint 57).
 * Exercises the real composed runtime: discovery with real rawData → real
 * Marketing provisioning → onboarding first result. No network, no LLM:
 * deterministic pipeline only.
 */
describe("Customer Zero session composition", () => {
  it("runs discovery with real company data and reduces gaps", async () => {
    const organizationId = "org_test_composition_moon";
    const session = getOrCreateCustomerZeroSession(organizationId, { llm: stubLlm() });
    session.state.companyName = "MOON Shared Living";

    // Simulate the CEO-provided company information (as the web analysis
    // would produce, but deterministic for the test).
    session.state.rawData = {
      mission: {
        statement: "Co-living compartido en Barcelona y Madrid",
        confidence: { level: "verified", source: "user_input", lastVerified: new Date().toISOString() },
      },
      market: {
        industry: "co-living",
        competition: "medium",
        confidence: { level: "verified", source: "user_input", lastVerified: new Date().toISOString() },
      },
      products: [
        {
          id: "p1",
          name: "Habitación en piso compartido",
          description: "Habitación amueblada en piso gestionado",
          targetAudience: "Nómadas digitales",
          keyFeatures: [],
          stage: "launched",
          confidence: { level: "verified", source: "user_input", lastVerified: new Date().toISOString() },
        },
      ],
    };

    const report = await runDiscoveryForSession(session);

    expect(report.organizationId).toBe(organizationId);
    expect(report.companyDna.mission?.statement).toContain("Co-living");
    expect(report.companyDna.market?.industry).toBe("co-living");
    expect(report.companyDna.products.length).toBeGreaterThan(0);
    // With mission + market + products known, the mission and market gaps are
    // closed (they were critical/blocking with empty DNA).
    expect(report.gaps.some((g) => g.category === "mission")).toBe(false);
    expect(report.gaps.some((g) => g.category === "market")).toBe(false);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  it("creates a real Marketing department and delivers the first result", async () => {
    const organizationId = "org_test_composition_marketing";
    const session = getOrCreateCustomerZeroSession(organizationId, { llm: stubLlm() });
    session.state.companyName = "MOON Shared Living";
    session.state.rawData = {
      mission: {
        statement: "Co-living compartido en Barcelona y Madrid",
        confidence: { level: "verified", source: "user_input", lastVerified: new Date().toISOString() },
      },
    };

    // Discovery first (the onboarding reads the report via discovery.get).
    await runDiscoveryForSession(session);

    const { result, workflowResult } = await runMarketingPreparationForSession(session);

    expect(result.status).toBe("completed");

    // The Marketing department was REALLY created from tpl_marketing.
    const department = session.departmentService
      .list()
      .find((d) => d.organizationId === organizationId);
    expect(department).toBeDefined();
    expect(department?.directorAgentId).toBe("agent_marketing_director");
    expect(department?.employeeAgentIds).toContain("agent_content_strategist");
    expect(department?.status).toBe("active");

    // The first result was delivered by the pipeline.
    expect(workflowResult).not.toBeNull();
    expect(workflowResult?.status).toBe("completed");
  });
});

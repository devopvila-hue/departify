import { describe, it, expect } from "vitest";
import type { LlmRouter } from "@departify/llm-router";
import {
  getOrCreateCustomerZeroSession,
  runDiscoveryForSession,
  runMarketingPreparationForSession,
  executeMarketingWorkItemForSession,
  approveMarketingWorkItemForSession,
} from "../src/customer-zero/customer-zero-session.js";
import { buildAnswersRawData } from "../src/customer-zero/answers.js";
import { curateMandatoryQuestions } from "../src/customer-zero/questions.js";
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

  it("persists the CEO's answers into the Company DNA and reduces gaps", async () => {
    const organizationId = "org_test_answers_persistence";
    const session = getOrCreateCustomerZeroSession(organizationId, { llm: stubLlm() });
    session.state.companyName = "MOON Shared Living";

    // Discovery with an empty rawData → many gaps.
    const before = await runDiscoveryForSession(session);
    const questionsBefore = curateMandatoryQuestions(before);
    expect(questionsBefore.length).toBeGreaterThan(0);

    // The CEO answers the mandatory questions; answers persist into the DNA.
    const answers: Record<string, string> = {};
    for (const question of questionsBefore) {
      answers[question.category] = `Respuesta del CEO para ${question.category}`;
    }
    session.state.rawData = {
      ...session.state.rawData,
      ...buildAnswersRawData(answers),
    };

    const after = await runDiscoveryForSession(session);

    // The answered categories are now closed (user_input wins).
    for (const question of questionsBefore) {
      expect(after.gaps.some((g) => g.category === question.category)).toBe(false);
    }
    // Fewer mandatory questions remain after the CEO answered.
    const questionsAfter = curateMandatoryQuestions(after);
    expect(questionsAfter.length).toBeLessThanOrEqual(questionsBefore.length);

    // The DNA retains the CEO's explicit answer with user_input provenance.
    const missionAnswer = answers.mission;
    if (missionAnswer) {
      expect(after.companyDna.mission?.statement).toBe(missionAnswer);
    }
  });

  it("runs Marketing work with approvals and honest execution", async () => {
    const organizationId = "org_test_marketing_work";
    const session = getOrCreateCustomerZeroSession(organizationId, { llm: stubLlm() });
    session.state.companyName = "MOON Shared Living";
    session.state.rawData = {
      mission: {
        statement: "Co-living compartido en Barcelona y Madrid",
        confidence: { level: "verified", source: "user_input", lastVerified: new Date().toISOString() },
      },
    };

    // The Marketing department is prepared (the marketing tools are executed
    // through the real runtime later; here we plant a plan state to exercise
    // the execute/approve state machine deterministically).
    session.state.marketingWork = {
      goal: "Necesito conseguir más clientes.",
      summary: "Plan de crecimiento para MOON",
      items: [
        {
          id: "item_1",
          title: "Analizar audiencia",
          description: "Estudio del cliente ideal",
          kind: "analysis",
          status: "pending",
        },
        {
          id: "item_2",
          title: "Borrador de campaña",
          description: "Copy para redes",
          kind: "creation",
          status: "pending",
        },
        {
          id: "item_3",
          title: "Lanzar campaña de anuncios",
          description: "Inversión en anuncios",
          kind: "external_action",
          capability: "ads_spend",
          status: "needs_approval",
        },
      ],
    };

    // Executable items (analysis/creation) run through the real runtime; with
    // the stub LLM the marketing.execute tool cannot produce a usable result,
    // so the item is marked failed with an honest message — never fabricated.
    const execResult = await executeMarketingWorkItemForSession(session, "item_1");
    expect(session.state.marketingWork?.items.find((i) => i.id === "item_1")?.status).toBe(
      "failed",
    );
    expect(execResult.length).toBeGreaterThan(0);

    // Gated item requires approval before execution.
    await expect(
      executeMarketingWorkItemForSession(session, "item_3"),
    ).rejects.toThrow(/requires CEO approval/i);

    // Approving a gated item marks it unavailable (capability not connected).
    const approved = approveMarketingWorkItemForSession(session, "item_3");
    expect(approved.status).toBe("unavailable");
    // Honest, and in the head's own voice: no capability ids, no runtime
    // vocabulary reaches the CEO.
    expect(approved.result).toContain("herramientas conectada");
    expect(approved.result).not.toContain("external_action");
    expect(approved.result).not.toMatch(/capacidad|runtime|tool/i);
  });
});

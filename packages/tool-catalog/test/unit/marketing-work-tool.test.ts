import { describe, it, expect, vi } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import type { LlmRouter } from "@departify/llm-router";
import {
  createMarketingPlanToolDefinition,
  createMarketingExecuteToolDefinition,
} from "../../src/index.js";
import type { CompanyDiscoveryReport } from "@departify/business-discovery";

function buildReport(organizationId: string): CompanyDiscoveryReport {
  return {
    organizationId,
    sessionId: `session_${organizationId}`,
    metadata: {
      sessionId: `session_${organizationId}`,
      startedAt: new Date("2026-08-07T10:00:00Z"),
      completedAt: new Date("2026-08-07T10:00:01Z"),
      durationMs: 1000,
      sources: [],
      dataPoints: 0,
      questionsAsked: 0,
      questionsAnswered: 0,
    },
    companyDna: {
      organizationId,
      mission: {
        statement: "MOON Shared Living: co-living compartido en Barcelona y Madrid",
        confidence: {
          level: "verified",
          source: "user_input",
          lastVerified: new Date("2026-08-07T10:00:00Z"),
        },
      },
      market: {
        industry: "co-living",
        competition: "medium",
        confidence: {
          level: "verified",
          source: "user_input",
          lastVerified: new Date("2026-08-07T10:00:00Z"),
        },
      },
      products: [
        {
          id: "room",
          name: "Habitación en piso compartido",
          description: "Habitación amueblada en piso gestionado",
          targetAudience: "Nómadas digitales",
          keyFeatures: [],
          stage: "launched",
          confidence: {
            level: "verified",
            source: "user_input",
            lastVerified: new Date("2026-08-07T10:00:00Z"),
          },
        },
      ],
      values: [],
      services: [],
      strengths: [],
      weaknesses: [],
      objectives: [],
      processes: [],
    } as unknown as CompanyDiscoveryReport["companyDna"],
    findings: [],
    gaps: [],
    questions: [],
    confidence: {
      overall: "low",
      companyDna: 0,
      founderBrain: 0,
      breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
    },
    generatedAt: new Date("2026-08-07T10:00:01Z"),
  };
}

const context = {
  toolId: "marketing.plan",
  toolVersion: "1.0.0",
  requestId: "req_marketing_plan_001",
};

function buildRouter(reply: string): LlmRouter {
  return {
    chat: vi.fn().mockResolvedValue({ type: "chat", message: reply }),
  } as unknown as LlmRouter;
}

describe("marketing.plan Tool", () => {
  it("turns the CEO goal into a structured work plan grounded in the DNA", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_plan_001",
      sessionId: "session_plan_001",
      organizationId: "org_moon",
      report: buildReport("org_moon"),
      savedAt: new Date("2026-08-07T10:00:02Z"),
    });

    const router = buildRouter(
      JSON.stringify({
        summary: "Plan de crecimiento para MOON",
        items: [
          {
            id: "item_1",
            title: "Analizar audiencia de nómadas digitales",
            description: "Estudio del cliente ideal en Barcelona y Madrid",
            kind: "analysis",
          },
          {
            id: "item_2",
            title: "Borrador de campaña en redes sociales",
            description: "Copy y creatividades para redes",
            kind: "creation",
            capability: "social_media",
          },
          {
            id: "item_3",
            title: "Lanzar campaña de anuncios",
            description: "Inversión en anuncios para captar clientes",
            kind: "external_action",
            capability: "ads_spend",
          },
        ],
      }),
    );

    const tool = createMarketingPlanToolDefinition({ repository, llmRouter: router });
    const output = await tool.executor!(
      context,
      { organizationId: "org_moon", goal: "Necesito conseguir más clientes." },
      {} as AbortSignal,
    );

    expect(output.summary).toContain("MOON");
    expect(output.items).toHaveLength(3);
    // The three kinds classify what is executable vs gated.
    expect(output.items.map((i) => i.kind)).toEqual([
      "analysis",
      "creation",
      "external_action",
    ]);

    // The plan prompt was grounded in the real Company DNA.
    const chatMock = vi.mocked(router.chat);
    const request = chatMock.mock.calls[0]?.[0] as {
      messages: readonly { content: string }[];
    };
    const systemPrompt = request.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("MOON Shared Living");
    expect(systemPrompt).toContain("co-living");
  });

  it("throws a typed error when the LLM produces no usable plan", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_plan_002",
      sessionId: "session_plan_002",
      organizationId: "org_moon",
      report: buildReport("org_moon"),
      savedAt: new Date("2026-08-07T10:00:02Z"),
    });

    const router = buildRouter("Lo siento, no entiendo el objetivo.");
    const tool = createMarketingPlanToolDefinition({ repository, llmRouter: router });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_moon", goal: "sube ventas" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/could not produce a plan/i);
  });

  it("throws a typed error when no business context exists", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const router = buildRouter("{}");
    const tool = createMarketingPlanToolDefinition({ repository, llmRouter: router });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_unknown", goal: "crecer" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no business context/i);
  });
});

describe("marketing.execute Tool", () => {
  it("produces a real deliverable grounded in the DNA", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_exec_001",
      sessionId: "session_exec_001",
      organizationId: "org_moon",
      report: buildReport("org_moon"),
      savedAt: new Date("2026-08-07T10:00:02Z"),
    });

    const router = buildRouter(
      "Propuesta para MOON: crear contenido sobre comunidad en pisos compartidos de Barcelona dirigido a nómadas digitales.",
    );
    const tool = createMarketingExecuteToolDefinition({ repository, llmRouter: router });

    const output = await tool.executor!(
      { ...context, toolId: "marketing.execute" },
      {
        organizationId: "org_moon",
        item: {
          id: "item_1",
          title: "Analizar audiencia",
          description: "Estudio del cliente ideal",
          kind: "analysis",
        },
      },
      {} as AbortSignal,
    );

    expect(output.result).toContain("MOON");
    expect(output.result).toContain("Barcelona");
  });

  it("throws when no business context exists", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const router = buildRouter("n/a");
    const tool = createMarketingExecuteToolDefinition({ repository, llmRouter: router });

    await expect(
      tool.executor!(
        { ...context, toolId: "marketing.execute" },
        {
          organizationId: "org_unknown",
          item: { id: "x", title: "T", description: "D", kind: "analysis" },
        },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no business context/i);
  });
});

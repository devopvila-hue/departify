import { describe, it, expect, vi } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import type { LlmRouter } from "@departify/llm-router";
import { createMarketingChatToolDefinition } from "../../src/index.js";
import type { CompanyDiscoveryReport } from "@departify/business-discovery";

function buildReport(organizationId: string): CompanyDiscoveryReport {
  return {
    organizationId,
    sessionId: `session_${organizationId}`,
    metadata: {
      sessionId: `session_${organizationId}`,
      startedAt: new Date("2026-08-06T10:00:00Z"),
      completedAt: new Date("2026-08-06T10:00:01Z"),
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
          lastVerified: new Date("2026-08-06T10:00:00Z"),
        },
      },
      market: {
        industry: "co-living",
        competition: "medium",
        confidence: {
          level: "verified",
          source: "user_input",
          lastVerified: new Date("2026-08-06T10:00:00Z"),
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
            lastVerified: new Date("2026-08-06T10:00:00Z"),
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
    generatedAt: new Date("2026-08-06T10:00:01Z"),
  };
}

const context = {
  toolId: "marketing.chat",
  toolVersion: "1.0.0",
  requestId: "req_marketing_chat_001",
};

function buildRouter(reply: string): LlmRouter {
  return {
    chat: vi.fn().mockResolvedValue({ type: "chat", message: reply }),
  } as unknown as LlmRouter;
}

describe("marketing.chat Tool", () => {
  it("replies grounding the answer in the real Company DNA", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_mkt_001",
      sessionId: "session_mkt_001",
      organizationId: "org_moon",
      report: buildReport("org_moon"),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const router = buildRouter(
      "Prioridad: llenar las habitaciones de Barcelona con contenido que hable de comunidad.",
    );
    const tool = createMarketingChatToolDefinition({ repository, llmRouter: router });

    const output = await tool.executor!(
      context,
      {
        organizationId: "org_moon",
        message: "¿Cuál sería la primera prioridad de Marketing?",
      },
      {} as AbortSignal,
    );

    expect(output.reply).toContain("comunidad");
    // The tool fed the LLM the real context: mission and product must appear
    // in the system prompt sent to the provider.
    const chatMock = vi.mocked(router.chat);
    expect(chatMock).toHaveBeenCalledTimes(1);
    const request = chatMock.mock.calls[0]?.[0] as {
      messages: readonly { role: string; content: string }[];
    };
    const systemPrompt = request.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("MOON Shared Living");
    expect(systemPrompt).toContain("co-living");
    expect(systemPrompt).toContain("Habitación");
  });

  it("carries the conversation history so the Director keeps context", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_mkt_002",
      sessionId: "session_mkt_002",
      organizationId: "org_moon",
      report: buildReport("org_moon"),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const router = buildRouter("Sí, como comentamos.");
    const tool = createMarketingChatToolDefinition({ repository, llmRouter: router });

    await tool.executor!(
      context,
      {
        organizationId: "org_moon",
        message: "¿Confirmas la prioridad?",
        history: [
          { role: "user", content: "Prioridad: contenido para nómadas digitales." },
          { role: "assistant", content: "Anotado." },
        ],
      },
      {} as AbortSignal,
    );

    const chatMock = vi.mocked(router.chat);
    const request = chatMock.mock.calls[0]?.[0] as {
      messages: readonly { role: string; content: string }[];
    };
    const contents = request.messages.map((m) => m.content);
    expect(contents).toContain("Prioridad: contenido para nómadas digitales.");
    expect(contents).toContain("Anotado.");
    expect(contents).toContain("¿Confirmas la prioridad?");
  });

  it("throws a typed error when no business context exists", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const router = buildRouter("n/a");
    const tool = createMarketingChatToolDefinition({ repository, llmRouter: router });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_unknown", message: "Hola" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no business context/i);
  });
});

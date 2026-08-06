import { describe, it, expect } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import { createDiscoveryDelegateToolDefinition } from "../../src/index.js";
import type {
  CompanyDiscoveryReport,
  DiscoveryQuestion,
} from "@departify/business-discovery";

function buildReport(
  organizationId: string,
  questions: DiscoveryQuestion[],
): CompanyDiscoveryReport {
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
      questionsAsked: questions.length,
      questionsAnswered: 0,
    },
    companyDna: {
      organizationId,
    } as unknown as CompanyDiscoveryReport["companyDna"],
    findings: [],
    gaps: [],
    questions,
    confidence: {
      overall: "low",
      companyDna: 0,
      founderBrain: 0,
      breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
    },
    generatedAt: new Date("2026-08-06T10:00:01Z"),
  };
}

function question(
  id: string,
  category: DiscoveryQuestion["category"],
  priority: number,
): DiscoveryQuestion {
  return {
    id,
    gapId: `gap_${id}`,
    category,
    question: `Question ${id}`,
    type: "open",
    priority,
    context: "ctx",
    importance: "high",
  };
}

const context = {
  toolId: "discovery.delegate",
  toolVersion: "1.0.0",
  requestId: "req_discovery_delegate_001",
};

describe("discovery.delegate Tool", () => {
  it("delegates each plan item to the competent agent by category", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_001",
      sessionId: "session_001",
      organizationId: "org_departify",
      report: buildReport("org_departify", [
        question("q_mission", "mission", 100),
        question("q_products", "products", 80),
        question("q_tone", "tone", 60),
        question("q_objectives", "objectives", 40),
      ]),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const tool = createDiscoveryDelegateToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as {
      delegation: { workItem: { id: string }; agentId: string }[];
    };

    expect(output.delegation.map((d) => d.workItem.id)).toEqual([
      "q_mission",
      "q_products",
      "q_tone",
      "q_objectives",
    ]);
    expect(output.delegation.map((d) => d.agentId)).toEqual([
      "agent_sales_director",
      "agent_lead_qualifier",
      "agent_outreach_specialist",
      "agent_proposal_writer",
    ]);
  });

  it("throws a typed error when the organization has no report", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const tool = createDiscoveryDelegateToolDefinition({ repository });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_unknown" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no discovery report/i);
  });

  it("returns an empty delegation when the report has no questions", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_002",
      sessionId: "session_002",
      organizationId: "org_departify",
      report: buildReport("org_departify", []),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const tool = createDiscoveryDelegateToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as { delegation: unknown[] };

    expect(output.delegation).toHaveLength(0);
  });
});

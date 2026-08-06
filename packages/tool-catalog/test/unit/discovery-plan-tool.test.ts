import { describe, it, expect } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import { createDiscoveryPlanToolDefinition } from "../../src/index.js";
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
  priority: number,
  importance: DiscoveryQuestion["importance"],
): DiscoveryQuestion {
  return {
    id,
    gapId: `gap_${id}`,
    category: "mission",
    question: `Question ${id}`,
    type: "open",
    priority,
    context: "ctx",
    importance,
  };
}

const context = {
  toolId: "discovery.plan",
  toolVersion: "1.0.0",
  requestId: "req_discovery_plan_001",
};

describe("discovery.plan Tool", () => {
  it("builds a plan ordered by priority (highest first)", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_001",
      sessionId: "session_001",
      organizationId: "org_departify",
      report: buildReport("org_departify", [
        question("q_low", 10, "low"),
        question("q_high", 100, "critical"),
        question("q_mid", 50, "high"),
      ]),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const tool = createDiscoveryPlanToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as { items: { questionId: string; priority: number }[] };

    expect(output.items.map((item) => item.questionId)).toEqual([
      "q_high",
      "q_mid",
      "q_low",
    ]);
    expect(output.items[0]?.priority).toBe(100);
  });

  it("honours the maxItems cap", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_002",
      sessionId: "session_002",
      organizationId: "org_departify",
      report: buildReport("org_departify", [
        question("q_a", 100, "critical"),
        question("q_b", 50, "high"),
        question("q_c", 10, "low"),
      ]),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const tool = createDiscoveryPlanToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify", maxItems: 2 },
      {} as AbortSignal,
    )) as unknown as { items: { questionId: string }[] };

    expect(output.items).toHaveLength(2);
    expect(output.items.map((item) => item.questionId)).toEqual(["q_a", "q_b"]);
  });

  it("throws a typed error when the organization has no report", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const tool = createDiscoveryPlanToolDefinition({ repository });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_unknown" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no discovery report/i);
  });
});

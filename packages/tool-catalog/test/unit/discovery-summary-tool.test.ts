import { describe, it, expect } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import { createDiscoverySummaryToolDefinition } from "../../src/index.js";
import type {
  CompanyDiscoveryReport,
  DiscoveryGap,
  DiscoveryQuestion,
} from "@departify/business-discovery";

function buildReport(
  organizationId: string,
  gaps: DiscoveryGap[],
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
    gaps,
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

function gap(
  id: string,
  importance: DiscoveryGap["importance"],
  blockingAction: boolean,
): DiscoveryGap {
  return { id, category: "mission", description: "Missing", importance, blockingAction };
}

const context = {
  toolId: "discovery.summary",
  toolVersion: "1.0.0",
  requestId: "req_discovery_summary_001",
};

describe("discovery.summary Tool", () => {
  it("derives deterministic metrics from the report", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_001",
      sessionId: "session_001",
      organizationId: "org_departify",
      report: buildReport(
        "org_departify",
        [
          gap("gap_mission", "critical", true),
          gap("gap_values", "high", false),
          gap("gap_services", "medium", false),
        ],
        [
          {
            id: "q_mission",
            gapId: "gap_mission",
            category: "mission",
            question: "Mission?",
            type: "open",
            priority: 100,
            context: "ctx",
            importance: "critical",
          },
        ],
      ),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const tool = createDiscoverySummaryToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as {
      overallConfidence: string;
      gapCount: number;
      criticalGapCount: number;
      blockingGapCount: number;
      questionCount: number;
    };

    expect(output.overallConfidence).toBe("low");
    expect(output.gapCount).toBe(3);
    expect(output.criticalGapCount).toBe(1);
    expect(output.blockingGapCount).toBe(1);
    expect(output.questionCount).toBe(1);
  });

  it("throws a typed error when the organization has no report", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const tool = createDiscoverySummaryToolDefinition({ repository });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_unknown" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no discovery report/i);
  });
});

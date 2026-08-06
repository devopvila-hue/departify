import { describe, it, expect } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import { createDiscoveryReadinessToolDefinition } from "../../src/index.js";
import type {
  CompanyDiscoveryReport,
  DiscoveryGap,
} from "@departify/business-discovery";

function buildReport(
  organizationId: string,
  gaps: DiscoveryGap[],
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
      questionsAsked: 0,
      questionsAnswered: 0,
    },
    companyDna: {
      organizationId,
    } as unknown as CompanyDiscoveryReport["companyDna"],
    findings: [],
    gaps,
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

function gap(
  id: string,
  importance: DiscoveryGap["importance"],
  blockingAction: boolean,
): DiscoveryGap {
  return { id, category: "mission", description: "Missing info", importance, blockingAction };
}

const context = {
  toolId: "discovery.readiness",
  toolVersion: "1.0.0",
  requestId: "req_discovery_readiness_001",
};

describe("discovery.readiness Tool", () => {
  it("decides ready=true when there are no blocking gaps", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_001",
      sessionId: "session_001",
      organizationId: "org_departify",
      report: buildReport("org_departify", [
        gap("gap_services", "medium", false),
        gap("gap_processes", "low", false),
      ]),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const tool = createDiscoveryReadinessToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as {
      ready: boolean;
      blockingGaps: unknown[];
      criticalGaps: unknown[];
    };

    expect(output.ready).toBe(true);
    expect(output.blockingGaps).toHaveLength(0);
    expect(output.criticalGaps).toHaveLength(0);
  });

  it("decides ready=false when there are blocking gaps", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_002",
      sessionId: "session_002",
      organizationId: "org_departify",
      report: buildReport("org_departify", [
        gap("gap_mission", "critical", true),
        gap("gap_values", "high", false),
      ]),
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const tool = createDiscoveryReadinessToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as {
      ready: boolean;
      blockingGaps: { id: string }[];
      criticalGaps: { id: string }[];
    };

    expect(output.ready).toBe(false);
    expect(output.blockingGaps.map((g) => g.id)).toEqual(["gap_mission"]);
    expect(output.criticalGaps.map((g) => g.id)).toEqual(["gap_mission"]);
  });

  it("throws a typed error when the organization has no report", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const tool = createDiscoveryReadinessToolDefinition({ repository });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_unknown" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no discovery report/i);
  });
});

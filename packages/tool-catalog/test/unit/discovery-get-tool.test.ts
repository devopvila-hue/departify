import { describe, it, expect } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import { createDiscoveryGetToolDefinition } from "../../src/index.js";
import type { CompanyDiscoveryReport } from "@departify/business-discovery";

function buildReport(organizationId: string, mission: string): CompanyDiscoveryReport {
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
        statement: mission,
        confidence: {
          level: "low",
          source: "user_input",
          lastVerified: new Date("2026-08-06T10:00:00Z"),
        },
      },
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
  toolId: "discovery.get",
  toolVersion: "1.0.0",
  requestId: "req_discovery_get_001",
};

describe("discovery.get Tool", () => {
  it("returns the most recent report of the organization", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    repository.save({
      executionId: "exe_disc_old",
      sessionId: "session_old",
      organizationId: "org_departify",
      report: buildReport("org_departify", "Old mission"),
      savedAt: new Date("2026-08-06T09:00:00Z"),
    });
    repository.save({
      executionId: "exe_disc_new",
      sessionId: "session_new",
      organizationId: "org_departify",
      report: buildReport("org_departify", "New mission"),
      savedAt: new Date("2026-08-06T10:00:00Z"),
    });

    const tool = createDiscoveryGetToolDefinition({ repository });
    const output = (await tool.executor!(
      context,
      { organizationId: "org_departify" },
      {} as AbortSignal,
    )) as unknown as {
      report: { companyDna: { mission: { statement: string } } };
      executionId: string;
      sessionId: string;
    };

    expect(output.executionId).toBe("exe_disc_new");
    expect(output.sessionId).toBe("session_new");
    expect(output.report.companyDna.mission.statement).toBe("New mission");
  });

  it("throws a typed error when the organization has no report", async () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();

    const tool = createDiscoveryGetToolDefinition({ repository });

    await expect(
      tool.executor!(
        context,
        { organizationId: "org_unknown" },
        {} as AbortSignal,
      ),
    ).rejects.toThrow(/no discovery report/i);
  });

  it("exposes deterministic capabilities and requires read.private scope", () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const tool = createDiscoveryGetToolDefinition({ repository });
    expect(tool.id).toBe("discovery.get");
    expect(tool.capabilities).toContain("idempotent");
    expect(tool.capabilities).toContain("side_effect_free");
    expect(tool.requiredScopes).toContain("read.private");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });
});

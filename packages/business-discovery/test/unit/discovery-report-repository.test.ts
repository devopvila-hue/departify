import { describe, it, expect } from "vitest";
import {
  createInMemoryDiscoveryReportRepository,
  InMemoryDiscoveryReportRepository,
  type DiscoveryReportRecord,
  type DiscoveryReportRepository,
} from "../../src/persistence/discovery-report-repository.js";
import { buildEmptyCompanyDNA } from "../../src/models/company-dna.js";
import type { CompanyDiscoveryReport } from "../../src/models/discovery-report.js";

function buildReport(organizationId: string): CompanyDiscoveryReport {
  const dna = buildEmptyCompanyDNA(organizationId);
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
    companyDna: dna,
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

function buildRecord(
  executionId: string,
  organizationId: string,
  savedAt = new Date("2026-08-06T10:00:02Z"),
): DiscoveryReportRecord {
  return {
    executionId,
    sessionId: `session_${organizationId}`,
    organizationId,
    report: buildReport(organizationId),
    savedAt,
  };
}

describe("InMemoryDiscoveryReportRepository", () => {
  it("saves and finds a report by execution id", () => {
    const repository: DiscoveryReportRepository =
      createInMemoryDiscoveryReportRepository();
    const record = buildRecord("exe_disc_001", "org_a");

    repository.save(record);

    expect(repository.findById("exe_disc_001")).toEqual(record);
    expect(repository.findById("exe_disc_missing")).toBeNull();
  });

  it("finds all reports of an organization", () => {
    const repository = new InMemoryDiscoveryReportRepository();
    repository.save(buildRecord("exe_disc_001", "org_a"));
    repository.save(buildRecord("exe_disc_002", "org_a"));
    repository.save(buildRecord("exe_disc_003", "org_b"));

    const orgARecords = repository.findByOrganizationId("org_a");
    expect(orgARecords.map((record) => record.executionId)).toEqual([
      "exe_disc_001",
      "exe_disc_002",
    ]);
    expect(repository.findByOrganizationId("org_b")).toHaveLength(1);
    expect(repository.findByOrganizationId("org_unknown")).toHaveLength(0);
  });

  it("overwrites a record saved with the same execution id", () => {
    const repository = createInMemoryDiscoveryReportRepository();
    repository.save(buildRecord("exe_disc_001", "org_a"));
    repository.save(
      buildRecord(
        "exe_disc_001",
        "org_a",
        new Date("2026-08-06T11:00:00Z"),
      ),
    );

    expect(repository.list()).toHaveLength(1);
    expect(repository.findById("exe_disc_001")?.savedAt).toEqual(
      new Date("2026-08-06T11:00:00Z"),
    );
  });

  it("lists all stored records", () => {
    const repository = createInMemoryDiscoveryReportRepository();
    repository.save(buildRecord("exe_disc_001", "org_a"));
    repository.save(buildRecord("exe_disc_002", "org_b"));

    expect(repository.list()).toHaveLength(2);
  });
});

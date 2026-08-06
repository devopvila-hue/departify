import { describe, it, expect } from "vitest";
import {
  createInMemoryWorkResultRepository,
  InMemoryWorkResultRepository,
  type WorkResultRecord,
  type WorkResultRepository,
} from "../../src/persistence/work-result-repository.js";

function buildRecord(
  executionId: string,
  organizationId: string,
): WorkResultRecord {
  return {
    executionId,
    workflowId: "wf_first_result",
    organizationId,
    finalOutput: { gapCount: 3 },
    completedAt: "2026-08-06T10:00:02Z",
  };
}

describe("InMemoryWorkResultRepository", () => {
  it("saves and finds a result by execution id", () => {
    const repository: WorkResultRepository =
      createInMemoryWorkResultRepository();
    const record = buildRecord("wfe_001", "org_a");

    repository.save(record);

    expect(repository.findById("wfe_001")).toEqual(record);
    expect(repository.findById("wfe_missing")).toBeNull();
  });

  it("finds all results of an organization", () => {
    const repository = new InMemoryWorkResultRepository();
    repository.save(buildRecord("wfe_001", "org_a"));
    repository.save(buildRecord("wfe_002", "org_a"));
    repository.save(buildRecord("wfe_003", "org_b"));

    const orgARecords = repository.findByOrganizationId("org_a");
    expect(orgARecords.map((record) => record.executionId)).toEqual([
      "wfe_001",
      "wfe_002",
    ]);
    expect(repository.findByOrganizationId("org_b")).toHaveLength(1);
    expect(repository.findByOrganizationId("org_unknown")).toHaveLength(0);
  });

  it("overwrites a record saved with the same execution id", () => {
    const repository = createInMemoryWorkResultRepository();
    repository.save(buildRecord("wfe_001", "org_a"));
    repository.save({
      ...buildRecord("wfe_001", "org_a"),
      completedAt: "2026-08-06T11:00:00Z",
    });

    expect(repository.list()).toHaveLength(1);
    expect(repository.findById("wfe_001")?.completedAt).toBe(
      "2026-08-06T11:00:00Z",
    );
  });

  it("lists all stored records", () => {
    const repository = createInMemoryWorkResultRepository();
    repository.save(buildRecord("wfe_001", "org_a"));
    repository.save(buildRecord("wfe_002", "org_b"));

    expect(repository.list()).toHaveLength(2);
  });
});

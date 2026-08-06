/**
 * Work Result Repository — Sprint 46.
 *
 * Makes the finished work of a Digital Employee recoverable. A `WorkflowResult`
 * (Sprint 26) is produced by every workflow run, but until now it was only
 * returned to the caller and lost afterwards. This repository persists the
 * completed results so the Empresa Digital can consult the work it has
 * delivered — Departify sells finished work.
 *
 * Provider-agnostic port + default in-memory implementation, following the
 * repository pattern used across the codebase (e.g.
 * `InMemoryDiscoveryReportRepository`, Sprint 36).
 */

import type { WorkflowExecutionId, WorkflowId, WorkflowResult } from "../workflow-types.js";

/**
 * Identifier of an organization (string alias kept local to the package).
 */
export type WorkOrganizationId = string;

/**
 * Record stored by the repository. Immutable snapshot of a completed
 * workflow result, keyed by execution id.
 */
export interface WorkResultRecord {
  readonly executionId: WorkflowExecutionId;
  readonly workflowId: WorkflowId;
  readonly organizationId: WorkOrganizationId;
  readonly finalOutput: unknown;
  readonly completedAt: string;
}

/**
 * Provider-neutral repository for completed work results.
 */
export interface WorkResultRepository {
  save(record: WorkResultRecord): void;
  findById(executionId: WorkflowExecutionId): WorkResultRecord | null;
  findByOrganizationId(organizationId: WorkOrganizationId): readonly WorkResultRecord[];
  list(): readonly WorkResultRecord[];
}

/**
 * Default in-memory implementation. Safe for tests and single-host
 * compositions; hosts that need durable storage provide their own adapter
 * behind the same `WorkResultRepository` port.
 */
export class InMemoryWorkResultRepository implements WorkResultRepository {
  private readonly records = new Map<WorkflowExecutionId, WorkResultRecord>();

  save(record: WorkResultRecord): void {
    this.records.set(record.executionId, record);
  }

  findById(executionId: WorkflowExecutionId): WorkResultRecord | null {
    return this.records.get(executionId) ?? null;
  }

  findByOrganizationId(
    organizationId: WorkOrganizationId,
  ): readonly WorkResultRecord[] {
    return [...this.records.values()].filter(
      (record) => record.organizationId === organizationId,
    );
  }

  list(): readonly WorkResultRecord[] {
    return [...this.records.values()];
  }
}

/**
 * Convenience factory.
 */
export function createInMemoryWorkResultRepository(): WorkResultRepository {
  return new InMemoryWorkResultRepository();
}

/**
 * Maps a completed `WorkflowResult` into a repository record. Only completed
 * results carry a final output; the caller is responsible for calling this
 * only when `result.status === "completed"`.
 */
export function toWorkResultRecord(
  result: WorkflowResult,
  organizationId: WorkOrganizationId,
): WorkResultRecord {
  return {
    executionId: result.executionId,
    workflowId: result.workflowId,
    organizationId,
    finalOutput: result.finalOutput,
    completedAt: result.completedAt,
  };
}

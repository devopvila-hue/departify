/**
 * Discovery Report Repository — Sprint 36.
 *
 * Makes the `CompanyDiscoveryReport` (the knowledge of the business) recoverable
 * after a Business Discovery run. The report is produced in memory by the
 * Executive Discovery Workflow (Sprint 31); without a repository it is lost as
 * soon as the run ends. The repository keeps it addressable by execution,
 * session and organization so the Empresa Digital can operate with it.
 *
 * Provider-agnostic port + default in-memory implementation, following the
 * repository pattern used across the codebase (e.g. `InMemoryRouterMetrics`).
 */

import type { CompanyDiscoveryReport } from "../models/discovery-report.js";

/**
 * Identifier of a discovery execution (matches the workflow execution id).
 */
export type DiscoveryExecutionId = string;

/**
 * Record stored by the repository. Immutable snapshot of a completed report.
 */
export interface DiscoveryReportRecord {
  readonly executionId: DiscoveryExecutionId;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly report: CompanyDiscoveryReport;
  readonly savedAt: Date;
}

/**
 * Provider-neutral repository for completed discovery reports.
 */
export interface DiscoveryReportRepository {
  save(record: DiscoveryReportRecord): void;
  findById(executionId: DiscoveryExecutionId): DiscoveryReportRecord | null;
  findByOrganizationId(
    organizationId: string,
  ): readonly DiscoveryReportRecord[];
  list(): readonly DiscoveryReportRecord[];
}

/**
 * Default in-memory implementation. Safe for tests and single-host
 * compositions; hosts that need durable storage provide their own adapter
 * behind the same `DiscoveryReportRepository` port.
 */
export class InMemoryDiscoveryReportRepository
  implements DiscoveryReportRepository
{
  private readonly records = new Map<
    DiscoveryExecutionId,
    DiscoveryReportRecord
  >();

  save(record: DiscoveryReportRecord): void {
    this.records.set(record.executionId, record);
  }

  findById(
    executionId: DiscoveryExecutionId,
  ): DiscoveryReportRecord | null {
    return this.records.get(executionId) ?? null;
  }

  findByOrganizationId(
    organizationId: string,
  ): readonly DiscoveryReportRecord[] {
    return [...this.records.values()].filter(
      (record) => record.organizationId === organizationId,
    );
  }

  list(): readonly DiscoveryReportRecord[] {
    return [...this.records.values()];
  }
}

/**
 * Convenience factory.
 */
export function createInMemoryDiscoveryReportRepository(): DiscoveryReportRepository {
  return new InMemoryDiscoveryReportRepository();
}

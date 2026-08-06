/**
 * Business Discovery Result — final outcome envelope.
 *
 * The result is what the Business Discovery pipeline returns to callers.
 * It contains the complete report or structured error information.
 */

import type {
  DiscoverySessionId,
  OrganizationId,
} from "./discovery-types.js";
import type { CompanyDiscoveryReport } from "../models/discovery-report.js";

/**
 * Possible statuses for a discovery result.
 */
export type BusinessDiscoveryStatus =
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

/**
 * Structured error information.
 */
export interface DiscoveryError {
  readonly code: string;
  readonly phase: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly retryable: boolean;
}

/**
 * Partial result information.
 */
export interface PartialResultInfo {
  readonly completedPhases: readonly string[];
  readonly skippedPhases: readonly string[];
  readonly reason: string;
}

/**
 * The final result envelope for Business Discovery.
 */
export interface BusinessDiscoveryResult {
  readonly organizationId: OrganizationId;
  readonly sessionId: DiscoverySessionId;
  readonly status: BusinessDiscoveryStatus;
  readonly report?: CompanyDiscoveryReport;
  readonly partialResult?: PartialResultInfo;
  readonly errors: readonly DiscoveryError[];
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly durationMs: number;
  readonly metadata: Readonly<{
    readonly phasesExecuted: number;
    readonly totalPhases: number;
    readonly dataPointsCollected: number;
    readonly confidence: "low" | "medium" | "high" | null;
  }>;
}

/**
 * Build a successful discovery result.
 */
export function buildDiscoverySuccess(
  input: {
    organizationId: OrganizationId;
    sessionId: DiscoverySessionId;
    report: CompanyDiscoveryReport;
    startedAt: Date;
    completedAt: Date;
  },
): BusinessDiscoveryResult {
  return {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    status: "completed",
    report: input.report,
    errors: [],
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    metadata: {
      phasesExecuted: 7,
      totalPhases: 7,
      dataPointsCollected: input.report.findings.length,
      confidence: input.report.confidence.overall,
    },
  };
}

/**
 * Build a partial discovery result.
 */
export function buildDiscoveryPartial(
  input: {
    organizationId: OrganizationId;
    sessionId: DiscoverySessionId;
    report?: CompanyDiscoveryReport;
    completedPhases: readonly string[];
    skippedPhases: readonly string[];
    reason: string;
    errors: readonly DiscoveryError[];
    startedAt: Date;
    completedAt: Date;
  },
): BusinessDiscoveryResult {
  const baseResult = {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    status: "partial" as const,
    partialResult: {
      completedPhases: input.completedPhases,
      skippedPhases: input.skippedPhases,
      reason: input.reason,
    },
    errors: input.errors,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    metadata: {
      phasesExecuted: input.completedPhases.length,
      totalPhases: 7,
      dataPointsCollected: input.report?.findings.length ?? 0,
      confidence: input.report?.confidence.overall ?? null,
    },
  };

  if (!input.report) {
    return baseResult;
  }

  return { ...baseResult, report: input.report };
}

/**
 * Build a failed discovery result.
 */
export function buildDiscoveryFailure(
  input: {
    organizationId: OrganizationId;
    sessionId: DiscoverySessionId;
    errors: readonly DiscoveryError[];
    startedAt: Date;
    completedAt: Date;
  },
): BusinessDiscoveryResult {
  return {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    status: "failed",
    errors: input.errors,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    metadata: {
      phasesExecuted: 0,
      totalPhases: 7,
      dataPointsCollected: 0,
      confidence: null,
    },
  };
}

/**
 * Build a cancelled discovery result.
 */
export function buildDiscoveryCancelled(
  input: {
    organizationId: OrganizationId;
    sessionId: DiscoverySessionId;
    reason: string;
    startedAt: Date;
    completedAt: Date;
  },
): BusinessDiscoveryResult {
  return {
    organizationId: input.organizationId,
    sessionId: input.sessionId,
    status: "cancelled",
    errors: [
      {
        code: "DISCOVERY_CANCELLED",
        phase: "unknown",
        message: input.reason,
        retryable: false,
      },
    ],
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    metadata: {
      phasesExecuted: 0,
      totalPhases: 7,
      dataPointsCollected: 0,
      confidence: null,
    },
  };
}

/**
 * Create a discovery error.
 */
export function createDiscoveryError(
  code: string,
  phase: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  retryable: boolean = false,
): DiscoveryError {
  const baseError = {
    code,
    phase,
    message,
    retryable,
  };

  if (!details) {
    return baseError;
  }

  return { ...baseError, details };
}

/**
 * Common error codes.
 */
export const DiscoveryErrorCode = {
  INITIALIZATION_FAILED: "INITIALIZATION_FAILED",
  DATA_COLLECTION_FAILED: "DATA_COLLECTION_FAILED",
  COMPANY_DNA_ANALYSIS_FAILED: "COMPANY_DNA_ANALYSIS_FAILED",
  FOUNDER_BRAIN_ANALYSIS_FAILED: "FOUNDER_BRAIN_ANALYSIS_FAILED",
  GAP_ANALYSIS_FAILED: "GAP_ANALYSIS_FAILED",
  QUESTION_GENERATION_FAILED: "QUESTION_GENERATION_FAILED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  INVALID_INPUT: "INVALID_INPUT",
} as const;

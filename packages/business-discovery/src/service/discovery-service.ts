/**
 * Business Discovery Service — main service facade.
 *
 * The service is the single entry point for Business Discovery operations.
 * It validates input, executes the pipeline, and returns typed results.
 */

import type {
  BusinessDiscoveryRequest,
  DiscoverySessionId,
  OrganizationId,
} from "../contracts/discovery-types.js";
import type { BusinessDiscoveryResult } from "../contracts/discovery-result.js";
import { validateBusinessDiscoveryRequest } from "../contracts/discovery-types.js";
import {
  buildDiscoveryFailure,
  createDiscoveryError,
  DiscoveryErrorCode,
} from "../contracts/discovery-result.js";
import {
  generateSessionId,
  executeDiscoveryPipeline,
  pipelineResultToDiscoveryResult,
  type PipelineContext,
} from "../pipeline/discovery-pipeline.js";
import { validateCompanyDNA } from "../models/company-dna.js";
import { validateFounderBrain } from "../models/founder-brain.js";
import { validateDiscoveryReport } from "../models/discovery-report.js";

/**
 * Service configuration.
 */
export interface BusinessDiscoveryServiceConfig {
  readonly now?: () => Date;
  readonly sessionIdGenerator?: () => DiscoverySessionId;
}

/**
 * Default configuration.
 */
const defaultConfig: Required<BusinessDiscoveryServiceConfig> = {
  now: () => new Date(),
  sessionIdGenerator: generateSessionId,
};

/**
 * Main Business Discovery Service.
 *
 * This is the only authorized entry point for Business Discovery operations.
 */
export class BusinessDiscoveryService {
  private readonly config: Required<BusinessDiscoveryServiceConfig>;
  private readonly activeSessions = new Map<DiscoverySessionId, OrganizationId>();

  constructor(config: BusinessDiscoveryServiceConfig = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Initiate a new business discovery.
   */
  async initiateDiscovery(
    rawRequest: unknown,
  ): Promise<BusinessDiscoveryResult> {
    const startedAt = this.config.now();

    // Validate request — never throw; convert validation errors to a typed failure.
    let request: BusinessDiscoveryRequest;
    try {
      request = validateBusinessDiscoveryRequest(rawRequest);
    } catch (error) {
      const sessionId = this.config.sessionIdGenerator();
      return buildDiscoveryFailure({
        organizationId: extractOrganizationId(rawRequest),
        sessionId,
        errors: [
          createDiscoveryError(
            DiscoveryErrorCode.VALIDATION_FAILED,
            "initialization",
            error instanceof Error
              ? error.message
              : "Invalid discovery request.",
            undefined,
            false,
          ),
        ],
        startedAt,
        completedAt: this.config.now(),
      });
    }

    // Generate session ID
    const sessionId = this.config.sessionIdGenerator();

    // Build context
    const context: PipelineContext = {
      organizationId: request.organizationId,
      sessionId,
      request,
      now: this.config.now,
    };

    // Track session
    this.activeSessions.set(sessionId, request.organizationId);

    try {
      // Execute pipeline
      const pipelineResult = await executeDiscoveryPipeline(request, context);

      // Convert to result
      const result = pipelineResultToDiscoveryResult(pipelineResult);

      // Clean up session on completion
      if (result.status === "completed" || result.status === "failed") {
        this.activeSessions.delete(sessionId);
      }

      return result;
    } catch (error) {
      this.activeSessions.delete(sessionId);

      // Return failure result
      return buildDiscoveryFailure({
        organizationId: request.organizationId,
        sessionId,
        errors: [
          createDiscoveryError(
            "PIPELINE_EXECUTION_FAILED",
            "unknown",
            error instanceof Error ? error.message : "Unknown error",
            undefined,
            true,
          ),
        ],
        startedAt: this.config.now(),
        completedAt: this.config.now(),
      });
    }
  }

  /**
   * Get active session count.
   */
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Check if a session is active.
   */
  isSessionActive(sessionId: DiscoverySessionId): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Get organization ID for a session.
   */
  getOrganizationForSession(sessionId: DiscoverySessionId): OrganizationId | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Validate a Business Discovery Request.
   */
  validateRequest(rawRequest: unknown): BusinessDiscoveryRequest {
    return validateBusinessDiscoveryRequest(rawRequest);
  }

  /**
   * Validate Company DNA.
   */
  validateCompanyDna(rawDna: unknown) {
    return validateCompanyDNA(rawDna);
  }

  /**
   * Validate Founder Brain.
   */
  validateFounderBrain(rawBrain: unknown) {
    return validateFounderBrain(rawBrain);
  }

  /**
   * Validate Discovery Report.
   */
  validateDiscoveryReport(rawReport: unknown) {
    return validateDiscoveryReport(rawReport);
  }
}

/**
 * Create a new Business Discovery Service.
 */
export function createBusinessDiscoveryService(
  config?: BusinessDiscoveryServiceConfig,
): BusinessDiscoveryService {
  return new BusinessDiscoveryService(config);
}

/**
 * Default service instance.
 */
export const defaultDiscoveryService = new BusinessDiscoveryService();

/**
 * Extract a best-effort organization ID from a raw request.
 *
 * Used to build a typed failed result when request validation fails before
 * a valid request object exists.
 */
function extractOrganizationId(rawRequest: unknown): OrganizationId {
  if (typeof rawRequest === "object" && rawRequest !== null) {
    const organizationId = (rawRequest as Record<string, unknown>).organizationId;
    if (typeof organizationId === "string") {
      return organizationId;
    }
  }
  return "";
}

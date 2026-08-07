import type {
  BusinessDiscoveryResult,
  BusinessDiscoveryService,
  CompanyDiscoveryReport,
  DiscoveryReportRepository,
} from "@departify/business-discovery";
import type { OrchestrationResult } from "../contracts/orchestration-result.js";
import type { ExecutiveOrchestrator } from "../orchestrator.js";

/**
 * Executive Discovery Workflow — the first official Executive workflow.
 *
 * Sprint 31 composes the two existing public boundaries into a single
 * executive flow:
 *
 *   1. Initiate Business Discovery (Sprint 28): `BusinessDiscoveryService
 *      .initiateDiscovery` runs the full pipeline and yields the Company DNA,
 *      Founder Brain, Gap Analysis and Discovery Questions inside a
 *      `BusinessDiscoveryResult`.
 *   2. Execute `discovery.analyze` through the official Executive flow
 *      (Sprint 30): `ExecutiveOrchestrator.orchestrateDiscoveryAnalyze`
 *      dispatches the Core Tool through ExecutiveDirector → AgentToolBridge →
 *      Tool Runtime → Core Tool Catalog, preserving the correlation chain.
 *   3. Compose a typed `ExecutiveDiscoveryWorkflowResult` that unifies the
 *      discovery report, the orchestration trace and execution metadata.
 *
 * No IA, no HTTP, no SDKs, no new runtimes or bridges. Pure composition over
 * existing public contracts.
 */

/**
 * Input for the Executive Discovery Workflow.
 */
export interface ExecutiveDiscoveryWorkflowInput {
  readonly organizationId: string;
  readonly requestedBy: string;
  /**
   * Discovery options forwarded to the BusinessDiscoveryRequest (Sprint 28).
   */
  readonly options: {
    readonly includeFounderBrain: boolean;
    readonly includeCompetitorAnalysis: boolean;
    readonly includeMarketAnalysis: boolean;
    readonly depth: "basic" | "standard" | "comprehensive";
  };
  /**
   * Priority of the discovery request.
   */
  readonly priority?: "low" | "normal" | "high";
  /**
   * Raw information about the real company (Sprint 55). Forwarded to the
   * Business Discovery request so the pipeline builds a real Company DNA
   * instead of an empty one when the CEO / host provides it.
   */
  readonly rawData?: Readonly<Record<string, unknown>>;
  /**
   * Question generation options forwarded to `discovery.analyze` (Sprint 30).
   */
  readonly questionOptions?: {
    readonly maxQuestionsPerGap?: number;
    readonly includeLowPriority?: boolean;
    readonly maxTotalQuestions?: number;
  };
}

/**
 * Workflow result envelope. Typed union so callers can narrow on success
 * vs. controlled failure without parsing strings.
 */
export type ExecutiveDiscoveryWorkflowResult =
  | {
      readonly status: "completed";
      readonly workflowId: "wf_executive_discovery";
      readonly executionId: string;
      readonly report: CompanyDiscoveryReport;
      readonly orchestration: OrchestrationResult;
      readonly discovery: BusinessDiscoveryResult;
      readonly startedAt: string;
      readonly completedAt: string;
      readonly durationMs: number;
      readonly error: null;
    }
  | {
      readonly status: "failed";
      readonly workflowId: "wf_executive_discovery";
      readonly executionId: string;
      readonly report: null;
      readonly orchestration: OrchestrationResult | null;
      readonly discovery: BusinessDiscoveryResult;
      readonly startedAt: string;
      readonly completedAt: string;
      readonly durationMs: number;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly phase: "discovery" | "orchestration";
      };
    };

export interface ExecutiveDiscoveryWorkflowOptions {
  readonly discoveryService: BusinessDiscoveryService;
  readonly orchestrator: ExecutiveOrchestrator;
  readonly clock?: () => Date;
  readonly executionIdFactory?: () => string;
  /**
   * Optional repository that stores the completed `CompanyDiscoveryReport`
   * (Sprint 36). Without it the workflow still completes — the report is
   * simply not persisted.
   */
  readonly reportRepository?: DiscoveryReportRepository;
}

const DEFAULT_EXECUTION_ID_PREFIX = "exe_disc";

/**
 * Official Executive Discovery Workflow. Composes Business Discovery
 * (Sprint 28) with the Executive Orchestrator's `discovery.analyze`
 * dispatch (Sprint 30).
 */
export class ExecutiveDiscoveryWorkflow {
  private readonly discoveryService: BusinessDiscoveryService;
  private readonly orchestrator: ExecutiveOrchestrator;
  private readonly clock: () => Date;
  private readonly executionIdFactory: () => string;
  private readonly reportRepository: DiscoveryReportRepository | undefined;

  constructor(options: ExecutiveDiscoveryWorkflowOptions) {
    this.discoveryService = options.discoveryService;
    this.orchestrator = options.orchestrator;
    this.clock = options.clock ?? (() => new Date());
    this.executionIdFactory =
      options.executionIdFactory ??
      (() =>
        `${DEFAULT_EXECUTION_ID_PREFIX}_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 8)}`);
    this.reportRepository = options.reportRepository;
  }

  /**
   * Runs the Executive Discovery Workflow:
   *   initiate → analyze (official flow) → typed report.
   */
  async run(
    input: ExecutiveDiscoveryWorkflowInput,
  ): Promise<ExecutiveDiscoveryWorkflowResult> {
    const executionId = this.executionIdFactory();
    const startedAt = this.clock();

    // Step 1 — Initiate Business Discovery (Sprint 28 pipeline).
    const discovery = await this.discoveryService.initiateDiscovery({
      organizationId: input.organizationId,
      requestedAt: this.clock(),
      priority: input.priority ?? "normal",
      options: input.options,
      ...(input.rawData ? { rawData: input.rawData } : {}),
    });

    if (discovery.status !== "completed" || !discovery.report) {
      return this.failed({
        executionId,
        startedAt,
        discovery,
        orchestration: null,
        error: {
          code: "DISCOVERY_NOT_COMPLETED",
          message: discovery.errors[0]?.message ?? "Discovery did not complete.",
          phase: "discovery",
        },
      });
    }

    // Step 2 — Execute `discovery.analyze` through the official Executive
    // flow (Sprint 30), feeding the DNA/Brain obtained by the pipeline.
    const orchestration = await this.orchestrator.orchestrateDiscoveryAnalyze({
      type: "discovery_analyze",
      intentId: `intent_disc_${executionId}`,
      requestedBy: input.requestedBy,
      organizationId: input.organizationId,
      toolArgs: {
        companyDna: discovery.report.companyDna,
        ...(discovery.report.founderBrain
          ? { founderBrain: discovery.report.founderBrain }
          : {}),
        ...(input.questionOptions
          ? { options: input.questionOptions }
          : {}),
      },
    });

    if (orchestration.tool.status !== "completed") {
      return this.failed({
        executionId,
        startedAt,
        discovery,
        orchestration,
        error: {
          code: orchestration.error?.code ?? "DISCOVERY_ANALYZE_FAILED",
          message:
            orchestration.error?.message ?? "discovery.analyze did not complete.",
          phase: "orchestration",
        },
      });
    }

    // Step 3 — Compose the typed report: the orchestration output is the
    // authoritative gap analysis / questions result; the discovery envelope
    // carries the DNA/Brain/report context.
    const report: CompanyDiscoveryReport = {
      ...discovery.report,
      gaps: this.extractGaps(orchestration.output),
      questions: this.extractQuestions(orchestration.output),
      generatedAt: this.clock(),
    };

    // Sprint 36 — persist the completed report when a repository is wired.
    if (this.reportRepository) {
      this.reportRepository.save({
        executionId,
        sessionId: discovery.report.sessionId,
        organizationId: discovery.report.organizationId,
        report,
        savedAt: this.clock(),
      });
    }

    const completedAt = this.clock();
    return {
      status: "completed",
      workflowId: "wf_executive_discovery",
      executionId,
      report,
      orchestration,
      discovery,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      error: null,
    };
  }

  private extractGaps(
    output: unknown,
  ): CompanyDiscoveryReport["gaps"] {
    if (typeof output !== "object" || output === null) {
      return [];
    }
    const candidate = output as Record<string, unknown>;
    const gaps = candidate.gaps as
      | { readonly gaps?: unknown }
      | undefined;
    if (!gaps || typeof gaps !== "object" || !Array.isArray(gaps.gaps)) {
      return [];
    }
    return (gaps.gaps as CompanyDiscoveryReport["gaps"]) ?? [];
  }

  private extractQuestions(
    output: unknown,
  ): CompanyDiscoveryReport["questions"] {
    if (typeof output !== "object" || output === null) {
      return [];
    }
    const candidate = output as Record<string, unknown>;
    if (!Array.isArray(candidate.questions)) {
      return [];
    }
    return (candidate.questions as CompanyDiscoveryReport["questions"]) ?? [];
  }

  private failed(input: {
    executionId: string;
    startedAt: Date;
    discovery: BusinessDiscoveryResult;
    orchestration: OrchestrationResult | null;
    error: { code: string; message: string; phase: "discovery" | "orchestration" };
  }): ExecutiveDiscoveryWorkflowResult {
    const completedAt = this.clock();
    return {
      status: "failed",
      workflowId: "wf_executive_discovery",
      executionId: input.executionId,
      report: null,
      orchestration: input.orchestration,
      discovery: input.discovery,
      startedAt: input.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - input.startedAt.getTime(),
      error: input.error,
    };
  }
}

/**
 * Factory for the official Executive Discovery Workflow.
 */
export function createExecutiveDiscoveryWorkflow(
  options: ExecutiveDiscoveryWorkflowOptions,
): ExecutiveDiscoveryWorkflow {
  return new ExecutiveDiscoveryWorkflow(options);
}

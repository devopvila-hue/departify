import { describe, it, expect } from "vitest";
import type {
  BusinessDiscoveryResult,
  BusinessDiscoveryService,
  CompanyDiscoveryReport,
} from "@departify/business-discovery";
import {
  buildEmptyCompanyDNA,
  buildEmptyFounderBrain,
  createInMemoryDiscoveryReportRepository,
  createMinimalConfidence,
} from "@departify/business-discovery";
import type { OrchestrationResult } from "../../src/contracts/orchestration-result.js";
import type { ExecutiveOrchestrator } from "../../src/orchestrator.js";
import type { DiscoveryAnalyzeIntent } from "../../src/index.js";
import {
  createExecutiveDiscoveryWorkflow,
  type ExecutiveDiscoveryWorkflowInput,
} from "../../src/index.js";

type ExecutiveDiscoveryWorkflowRunIntent = DiscoveryAnalyzeIntent;

function buildDiscoveryReport(): CompanyDiscoveryReport {
  return {
    organizationId: "org_departify",
    sessionId: "session_001",
    metadata: {
      sessionId: "session_001",
      startedAt: new Date("2026-08-06T10:00:00Z"),
      completedAt: new Date("2026-08-06T10:00:01Z"),
      durationMs: 1000,
      sources: [],
      dataPoints: 0,
      questionsAsked: 0,
      questionsAnswered: 0,
    },
    companyDna: {
      ...buildEmptyCompanyDNA("org_departify"),
      mission: {
        statement: "To make the world better",
        confidence: createMinimalConfidence("user_input"),
      },
    },
    founderBrain: buildEmptyFounderBrain("org_departify"),
    findings: [],
    gaps: [],
    questions: [],
    confidence: {
      overall: "low",
      companyDna: 10,
      founderBrain: 0,
      breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
    },
    generatedAt: new Date("2026-08-06T10:00:01Z"),
  };
}

function buildDiscoverySuccess(): BusinessDiscoveryResult {
  const report = buildDiscoveryReport();
  return {
    organizationId: report.organizationId,
    sessionId: report.sessionId,
    status: "completed",
    report,
    errors: [],
    startedAt: new Date("2026-08-06T10:00:00Z"),
    completedAt: new Date("2026-08-06T10:00:01Z"),
    durationMs: 1000,
    metadata: {
      phasesExecuted: 7,
      totalPhases: 7,
      dataPointsCollected: 0,
      confidence: "low",
    },
  };
}

function buildOrchestrationSuccess(): OrchestrationResult {
  return {
    intentId: "intent_disc_001",
    decisionId: "dec_001",
    actionId: "act_dec_001",
    decision: null,
    intent: {
      type: "discovery_analyze",
      intentId: "intent_disc_001",
      requestedBy: "tester",
    },
    tool: {
      toolId: "discovery.analyze",
      status: "completed",
    },
    output: {
      gaps: { gaps: [{ id: "gap_mission_001", category: "mission" }] },
      questions: [{ id: "q_mission_001" }],
    },
    error: null,
    startedAt: "2026-08-06T10:00:01Z",
    completedAt: "2026-08-06T10:00:02Z",
  };
}

const input: ExecutiveDiscoveryWorkflowInput = {
  organizationId: "org_departify",
  requestedBy: "tester",
  options: {
    includeFounderBrain: true,
    includeCompetitorAnalysis: false,
    includeMarketAnalysis: false,
    depth: "standard",
  },
};

describe("ExecutiveDiscoveryWorkflow", () => {
  it("composes discovery initiation with the official discovery.analyze flow", async () => {
    const discoveryService: BusinessDiscoveryService = {
      initiateDiscovery: async () => buildDiscoverySuccess(),
    } as unknown as BusinessDiscoveryService;
    const orchestrator: ExecutiveOrchestrator = {
      orchestrateDiscoveryAnalyze: async (
        intent: ExecutiveDiscoveryWorkflowRunIntent,
      ) => {
        expect(intent.type).toBe("discovery_analyze");
        expect(intent.toolArgs?.companyDna).toBeDefined();
        expect(intent.toolArgs?.founderBrain).toBeDefined();
        return buildOrchestrationSuccess();
      },
    } as unknown as ExecutiveOrchestrator;

    const workflow = createExecutiveDiscoveryWorkflow({
      discoveryService,
      orchestrator,
      clock: () => new Date("2026-08-06T10:00:00Z"),
      executionIdFactory: () => "exe_disc_test_001",
    });

    const result = await workflow.run(input);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.workflowId).toBe("wf_executive_discovery");
    expect(result.executionId).toBe("exe_disc_test_001");
    expect(result.report.organizationId).toBe("org_departify");
    expect(result.report.gaps).toHaveLength(1);
    expect(result.report.questions).toHaveLength(1);
    expect(result.orchestration.tool.toolId).toBe("discovery.analyze");
    expect(result.orchestration.tool.status).toBe("completed");
    expect(result.discovery.status).toBe("completed");
    expect(result.error).toBeNull();
  });

  it("fails in a controlled way when discovery does not complete", async () => {
    const failedDiscovery: BusinessDiscoveryResult = {
      organizationId: "org_departify",
      sessionId: "session_failed",
      status: "failed",
      errors: [
        {
          code: "VALIDATION_FAILED",
          phase: "initialization",
          message: "Invalid discovery request.",
          retryable: false,
        },
      ],
      startedAt: new Date("2026-08-06T10:00:00Z"),
      completedAt: new Date("2026-08-06T10:00:01Z"),
      durationMs: 1000,
      metadata: {
        phasesExecuted: 0,
        totalPhases: 7,
        dataPointsCollected: 0,
        confidence: null,
      },
    };
    const discoveryService: BusinessDiscoveryService = {
      initiateDiscovery: async () => failedDiscovery,
    } as unknown as BusinessDiscoveryService;
    const orchestrator: ExecutiveOrchestrator = {
      orchestrateDiscoveryAnalyze: async () => {
        throw new Error("must not run");
      },
    } as unknown as ExecutiveOrchestrator;

    const workflow = createExecutiveDiscoveryWorkflow({
      discoveryService,
      orchestrator,
      clock: () => new Date("2026-08-06T10:00:00Z"),
      executionIdFactory: () => "exe_disc_fail_001",
    });

    const result = await workflow.run(input);

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.report).toBeNull();
    expect(result.orchestration).toBeNull();
    expect(result.error?.phase).toBe("discovery");
    expect(result.error?.code).toBe("DISCOVERY_NOT_COMPLETED");
  });

  it("fails in a controlled way when discovery.analyze is rejected", async () => {
    const discoveryService: BusinessDiscoveryService = {
      initiateDiscovery: async () => buildDiscoverySuccess(),
    } as unknown as BusinessDiscoveryService;
    const rejected: OrchestrationResult = {
      intentId: "intent_disc_002",
      decisionId: "dec_002",
      actionId: "act_dec_002",
      decision: null,
      intent: {
        type: "discovery_analyze",
        intentId: "intent_disc_002",
        requestedBy: "tester",
      },
      tool: {
        toolId: "discovery.analyze",
        status: "rejected",
      },
      output: null,
      error: {
        code: "execution_denied",
        message: "Tool not authorized.",
        phase: "bridge",
      },
      startedAt: "2026-08-06T10:00:01Z",
      completedAt: "2026-08-06T10:00:02Z",
    };
    const orchestrator: ExecutiveOrchestrator = {
      orchestrateDiscoveryAnalyze: async () => rejected,
    } as unknown as ExecutiveOrchestrator;

    const workflow = createExecutiveDiscoveryWorkflow({
      discoveryService,
      orchestrator,
      clock: () => new Date("2026-08-06T10:00:00Z"),
      executionIdFactory: () => "exe_disc_rej_001",
    });

    const result = await workflow.run(input);

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.report).toBeNull();
    expect(result.orchestration?.tool.status).toBe("rejected");
    expect(result.error?.phase).toBe("orchestration");
    expect(result.error?.code).toBe("execution_denied");
  });

  it("persists the completed report when a repository is wired", async () => {
    const discoveryService: BusinessDiscoveryService = {
      initiateDiscovery: async () => buildDiscoverySuccess(),
    } as unknown as BusinessDiscoveryService;
    const orchestrator: ExecutiveOrchestrator = {
      orchestrateDiscoveryAnalyze: async () => buildOrchestrationSuccess(),
    } as unknown as ExecutiveOrchestrator;
    const reportRepository = createInMemoryDiscoveryReportRepository();

    const workflow = createExecutiveDiscoveryWorkflow({
      discoveryService,
      orchestrator,
      clock: () => new Date("2026-08-06T10:00:00Z"),
      executionIdFactory: () => "exe_disc_persist_001",
      reportRepository,
    });

    const result = await workflow.run(input);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    const stored = reportRepository.findById("exe_disc_persist_001");
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe("org_departify");
    expect(stored?.sessionId).toBe("session_001");
    expect(stored?.report.organizationId).toBe("org_departify");
    expect(stored?.report.gaps).toHaveLength(1);
  });

  it("does not fail when no report repository is wired", async () => {
    const discoveryService: BusinessDiscoveryService = {
      initiateDiscovery: async () => buildDiscoverySuccess(),
    } as unknown as BusinessDiscoveryService;
    const orchestrator: ExecutiveOrchestrator = {
      orchestrateDiscoveryAnalyze: async () => buildOrchestrationSuccess(),
    } as unknown as ExecutiveOrchestrator;

    const workflow = createExecutiveDiscoveryWorkflow({
      discoveryService,
      orchestrator,
      clock: () => new Date("2026-08-06T10:00:00Z"),
      executionIdFactory: () => "exe_disc_norepo_001",
    });

    const result = await workflow.run(input);

    expect(result.status).toBe("completed");
  });
});

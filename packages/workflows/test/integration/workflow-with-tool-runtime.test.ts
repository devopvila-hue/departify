import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
} from "@departify/agent-tool-bridge";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import { registerAllCoreTools } from "@departify/tool-catalog";
import {
  createInMemoryDiscoveryReportRepository,
  type CompanyDiscoveryReport,
} from "@departify/business-discovery";
import {
  buildBusinessBriefingWorkflow,
  buildBusinessReadinessWorkflow,
  buildDepartmentPlanWorkflow,
  buildDepartmentDelegationWorkflow,
  buildDepartmentOnboardingWorkflow,
  buildFirstWorkWorkflow,
  buildFirstResultWorkflow,
  buildLeadQualificationWorkflow,
  createInMemoryWorkResultRepository,
  WorkflowExecution,
} from "../../src/index.js";
import type { AgentToolPort } from "@departify/agent-tool-bridge";

/**
 * End-to-end integration: the Lead Qualification Workflow runs against a
 * real Tool Runtime + Core Tool Catalog + AgentToolBridge composition. No
 * IA, no LLM Router, no HTTP — just the existing tools dispatched through
 * the bridge.
 */
describe("Lead Qualification Workflow integration with Tool Runtime", () => {
  it("completes the workflow end-to-end using the canonical tool catalog", async () => {
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});
    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_lead_qualifier",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "system.uuid",
          },
        ],
      ],
      [
        "agent_outreach_specialist",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "system.uuid",
          },
        ],
      ],
      [
        "agent_proposal_writer",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "system.uuid",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((step) => step.status === "completed")).toBe(
      true,
    );

    // Step outputs flow through the chain.
    const step1Output = result.steps[0]?.output as { uuid?: string };
    const step2Metadata =
      result.steps[1]?.actionId !== undefined ? result.steps[1] : null;
    expect(step1Output?.uuid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(step2Metadata).not.toBeNull();
  });

  it("propagates authorization failures when an agent lacks scopes", async () => {
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});
    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(
        new Map([
          [
            "agent_lead_qualifier",
            [
              {
                scope: "runtime" as const,
                action: "execute" as const,
                resource: "system.uuid",
              },
            ],
          ],
          // agent_outreach_specialist has no permission to call system.uuid
        ]),
      ),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("failed");
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[1]?.status).toBe("failed");
    expect(result.error?.code).toBe("agent_not_registered");
  });
});

describe("Business Briefing Workflow integration with Tool Runtime", () => {
  it("lets the Sales Director read the discovery report through discovery.get", async () => {
    // Seed the repository with a completed discovery report.
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_briefing",
      metadata: {
        sessionId: "session_briefing",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 0,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
        mission: {
          statement: "To make the world better",
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
    repository.save({
      executionId: "exe_disc_briefing_001",
      sessionId: "session_briefing",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_sales_director",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "discovery.get",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(
      buildBusinessBriefingWorkflow("org_departify"),
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("completed");
    const output = result.steps[0]?.output as {
      report?: { organizationId?: string };
      executionId?: string;
    };
    expect(output.report?.organizationId).toBe("org_departify");
    expect(output.executionId).toBe("exe_disc_briefing_001");
  });

  it("lets the Sales Director take the readiness decision through discovery.readiness", async () => {
    // Seed a report with a blocking gap → decision must be ready=false.
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_readiness",
      metadata: {
        sessionId: "session_readiness",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 0,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
      } as unknown as CompanyDiscoveryReport["companyDna"],
      findings: [],
      gaps: [
        {
          id: "gap_mission",
          category: "mission",
          description: "Missing mission",
          importance: "critical",
          blockingAction: true,
        },
      ],
      questions: [],
      confidence: {
        overall: "low",
        companyDna: 0,
        founderBrain: 0,
        breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
      },
      generatedAt: new Date("2026-08-06T10:00:01Z"),
    };
    repository.save({
      executionId: "exe_disc_readiness_001",
      sessionId: "session_readiness",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_sales_director",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "discovery.readiness",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(
      buildBusinessReadinessWorkflow("org_departify"),
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("completed");
    const output = result.steps[0]?.output as {
      ready: boolean;
      blockingGaps: unknown[];
    };
    expect(output.ready).toBe(false);
    expect(output.blockingGaps).toHaveLength(1);
  });

  it("lets the Sales Director build the Department plan through discovery.plan", async () => {
    // Seed a report with questions of different priorities.
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_plan",
      metadata: {
        sessionId: "session_plan",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 3,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
      } as unknown as CompanyDiscoveryReport["companyDna"],
      findings: [],
      gaps: [],
      questions: [
        {
          id: "q_low",
          gapId: "gap_low",
          category: "mission",
          question: "Low priority question",
          type: "open",
          priority: 10,
          context: "ctx",
          importance: "low",
        },
        {
          id: "q_high",
          gapId: "gap_high",
          category: "mission",
          question: "High priority question",
          type: "open",
          priority: 100,
          context: "ctx",
          importance: "critical",
        },
      ],
      confidence: {
        overall: "low",
        companyDna: 0,
        founderBrain: 0,
        breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
      },
      generatedAt: new Date("2026-08-06T10:00:01Z"),
    };
    repository.save({
      executionId: "exe_disc_plan_001",
      sessionId: "session_plan",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_sales_director",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "discovery.plan",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(
      buildDepartmentPlanWorkflow("org_departify"),
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("completed");
    const output = result.steps[0]?.output as {
      items: { questionId: string; priority: number }[];
    };
    expect(output.items.map((item) => item.questionId)).toEqual([
      "q_high",
      "q_low",
    ]);
  });

  it("lets the Sales Director delegate the plan through discovery.delegate", async () => {
    // Seed a report with questions of different categories.
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_delegation",
      metadata: {
        sessionId: "session_delegation",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 2,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
      } as unknown as CompanyDiscoveryReport["companyDna"],
      findings: [],
      gaps: [],
      questions: [
        {
          id: "q_products",
          gapId: "gap_products",
          category: "products",
          question: "What products do you offer?",
          type: "open",
          priority: 100,
          context: "ctx",
          importance: "critical",
        },
        {
          id: "q_mission",
          gapId: "gap_mission",
          category: "mission",
          question: "What is your mission?",
          type: "open",
          priority: 90,
          context: "ctx",
          importance: "critical",
        },
      ],
      confidence: {
        overall: "low",
        companyDna: 0,
        founderBrain: 0,
        breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
      },
      generatedAt: new Date("2026-08-06T10:00:01Z"),
    };
    repository.save({
      executionId: "exe_disc_delegate_001",
      sessionId: "session_delegation",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_sales_director",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "discovery.delegate",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(
      buildDepartmentDelegationWorkflow("org_departify"),
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("completed");
    const output = result.steps[0]?.output as {
      delegation: { workItem: { id: string }; agentId: string }[];
    };
    expect(output.delegation).toHaveLength(2);
    expect(output.delegation[0]?.workItem.id).toBe("q_products");
    expect(output.delegation[0]?.agentId).toBe("agent_lead_qualifier");
    expect(output.delegation[1]?.workItem.id).toBe("q_mission");
    expect(output.delegation[1]?.agentId).toBe("agent_sales_director");
  });

  it("lets a delegated Digital Employee execute its first useful work", async () => {
    // Seed the repository with a completed discovery report.
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_first_work",
      metadata: {
        sessionId: "session_first_work",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 0,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
        mission: {
          statement: "To make the world better",
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
    repository.save({
      executionId: "exe_disc_first_work_001",
      sessionId: "session_first_work",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_lead_qualifier",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "discovery.get",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(
      buildFirstWorkWorkflow("org_departify", "agent_lead_qualifier"),
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[0]?.agentId).toBe("agent_lead_qualifier");
    const output = result.steps[0]?.output as {
      report?: { organizationId?: string };
    };
    expect(output.report?.organizationId).toBe("org_departify");
  });

  it("lets a delegated Digital Employee produce its first useful result", async () => {
    // Seed a report with gaps and questions.
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_first_result",
      metadata: {
        sessionId: "session_first_result",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 1,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
      } as unknown as CompanyDiscoveryReport["companyDna"],
      findings: [],
      gaps: [
        {
          id: "gap_mission",
          category: "mission",
          description: "Missing mission",
          importance: "critical",
          blockingAction: true,
        },
      ],
      questions: [
        {
          id: "q_mission",
          gapId: "gap_mission",
          category: "mission",
          question: "What is your mission?",
          type: "open",
          priority: 100,
          context: "ctx",
          importance: "critical",
        },
      ],
      confidence: {
        overall: "low",
        companyDna: 0,
        founderBrain: 0,
        breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
      },
      generatedAt: new Date("2026-08-06T10:00:01Z"),
    };
    repository.save({
      executionId: "exe_disc_first_result_001",
      sessionId: "session_first_result",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_lead_qualifier",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "discovery.summary",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(
      buildFirstResultWorkflow("org_departify", "agent_lead_qualifier"),
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[0]?.agentId).toBe("agent_lead_qualifier");
    const output = result.steps[0]?.output as {
      gapCount: number;
      criticalGapCount: number;
      blockingGapCount: number;
      questionCount: number;
    };
    expect(output.gapCount).toBe(1);
    expect(output.criticalGapCount).toBe(1);
    expect(output.blockingGapCount).toBe(1);
    expect(output.questionCount).toBe(1);
  });

  it("persists the first useful result so the Department can consult it", async () => {
    // Seed a report with a gap.
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_persist_result",
      metadata: {
        sessionId: "session_persist_result",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 0,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
      } as unknown as CompanyDiscoveryReport["companyDna"],
      findings: [],
      gaps: [
        {
          id: "gap_mission",
          category: "mission",
          description: "Missing mission",
          importance: "critical",
          blockingAction: true,
        },
      ],
      questions: [],
      confidence: {
        overall: "low",
        companyDna: 0,
        founderBrain: 0,
        breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
      },
      generatedAt: new Date("2026-08-06T10:00:01Z"),
    };
    repository.save({
      executionId: "exe_disc_persist_001",
      sessionId: "session_persist_result",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_lead_qualifier",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "discovery.summary",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const workResults = createInMemoryWorkResultRepository();
    const execution = new WorkflowExecution({
      port,
      workResultRepository: workResults,
      organizationId: "org_departify",
      executionIdFactory: () => "wfe_first_result_persist",
    });

    const result = await execution.run(
      buildFirstResultWorkflow("org_departify", "agent_lead_qualifier"),
    );

    expect(result.status).toBe("completed");
    const stored = workResults.findById("wfe_first_result_persist");
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe("org_departify");
    expect(stored?.workflowId).toBe("wf_first_result");
    const storedOutput = stored?.finalOutput as {
      gapCount: number;
      questionCount: number;
    };
    expect(storedOutput.gapCount).toBe(1);
    expect(storedOutput.questionCount).toBe(0);
    expect(
      workResults.findByOrganizationId("org_departify"),
    ).toHaveLength(1);
  });

  it("runs the full Department onboarding and delivers the first value", async () => {
    // Seed the repository with a completed discovery report (gaps + questions).
    const repository = createInMemoryDiscoveryReportRepository();
    const report: CompanyDiscoveryReport = {
      organizationId: "org_departify",
      sessionId: "session_onboarding",
      metadata: {
        sessionId: "session_onboarding",
        startedAt: new Date("2026-08-06T10:00:00Z"),
        completedAt: new Date("2026-08-06T10:00:01Z"),
        durationMs: 1000,
        sources: [],
        dataPoints: 0,
        questionsAsked: 1,
        questionsAnswered: 0,
      },
      companyDna: {
        organizationId: "org_departify",
        mission: {
          statement: "To make the world better",
          confidence: {
            level: "low",
            source: "user_input",
            lastVerified: new Date("2026-08-06T10:00:00Z"),
          },
        },
      } as unknown as CompanyDiscoveryReport["companyDna"],
      findings: [],
      gaps: [
        {
          id: "gap_mission",
          category: "mission",
          description: "Missing mission detail",
          importance: "high",
          blockingAction: false,
        },
      ],
      questions: [
        {
          id: "q_mission",
          gapId: "gap_mission",
          category: "mission",
          question: "What is your mission?",
          type: "open",
          priority: 100,
          context: "ctx",
          importance: "high",
        },
      ],
      confidence: {
        overall: "low",
        companyDna: 0,
        founderBrain: 0,
        breakdown: {} as CompanyDiscoveryReport["confidence"]["breakdown"],
      },
      generatedAt: new Date("2026-08-06T10:00:01Z"),
    };
    repository.save({
      executionId: "exe_disc_onboarding_001",
      sessionId: "session_onboarding",
      organizationId: "org_departify",
      report,
      savedAt: new Date("2026-08-06T10:00:02Z"),
    });

    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, { discoveryRepository: repository });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent_sales_director",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "*",
          },
        ],
      ],
      [
        "agent_lead_qualifier",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "*",
          },
        ],
      ],
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const workResults = createInMemoryWorkResultRepository();
    const execution = new WorkflowExecution({
      port,
      workResultRepository: workResults,
      organizationId: "org_departify",
      executionIdFactory: () => "wfe_onboarding_001",
    });

    const result = await execution.run(
      buildDepartmentOnboardingWorkflow(
        "org_departify",
        "agent_sales_director",
        "agent_lead_qualifier",
      ),
    );

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(6);
    expect(result.steps.every((step) => step.status === "completed")).toBe(true);

    // The finalOutput of the last step is the first value delivered:
    // the executive summary produced by the delegated employee.
    const finalOutput = result.finalOutput as {
      gapCount: number;
      questionCount: number;
    };
    expect(finalOutput.gapCount).toBe(1);
    expect(finalOutput.questionCount).toBe(1);

    // The finished onboarding work is persisted and recoverable.
    const stored = workResults.findById("wfe_onboarding_001");
    expect(stored).not.toBeNull();
    expect(stored?.workflowId).toBe("wf_department_onboarding");
    expect(
      workResults.findByOrganizationId("org_departify"),
    ).toHaveLength(1);
  });
});

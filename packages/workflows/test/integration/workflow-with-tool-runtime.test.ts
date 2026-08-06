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
  buildLeadQualificationWorkflow,
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
});

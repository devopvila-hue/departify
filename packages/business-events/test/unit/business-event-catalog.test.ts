import type {
  AgentToolPort,
  AgentToolAction,
  AgentToolActionResult,
} from "@departify/agent-tool-bridge";
import { WorkflowExecution } from "@departify/workflows";
import { createDepartmentService } from "@departify/departments";
import type { ExecutiveDiscoveryWorkflow } from "@departify/executive-orchestrator";
import {
  BusinessEventCatalog,
  buildCanonicalCatalog,
  buildDefaultCatalogHandlers,
  createBusinessEventCatalog,
  DEFAULT_LEAD_QUALIFICATION_WORKFLOW_ID,
  type BusinessEvent,
  type BusinessEventHandlerOutcome,
  type OrganizationCreator,
} from "../../src/index.js";

class SuccessAgentToolPort implements AgentToolPort {
  readonly calls: AgentToolAction[] = [];

  async executeAction(): Promise<AgentToolActionResult> {
    const envelope: AgentToolActionResult = {
      actionId: "act_001",
      requestId: "act_001",
      toolId: "system.uuid",
      toolVersion: "1.0.0",
      status: "completed",
      output: { uuid: "11111111-1111-4111-8111-111111111111" },
      durationMs: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return envelope;
  }
}

describe("BusinessEventCatalog", () => {
  it("builds the canonical catalog with the six default handlers", () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog, handlers } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });

    expect(catalog.size()).toBe(6);
    expect(catalog.has("payment.confirmed")).toBe(true);
    expect(catalog.has("lead.created")).toBe(true);
    expect(catalog.has("organization.created")).toBe(true);
    expect(catalog.has("organization.provisioned")).toBe(true);
    expect(catalog.has("organization.discovery_requested")).toBe(true);
    expect(catalog.has("organization.discovered")).toBe(true);
    expect([...catalog.list()].sort()).toEqual(
      [
        "payment.confirmed",
        "lead.created",
        "organization.created",
        "organization.provisioned",
        "organization.discovery_requested",
        "organization.discovered",
      ].sort(),
    );

    expect(typeof handlers["payment.confirmed"]).toBe("function");
    expect(typeof handlers["lead.created"]).toBe("function");
    expect(typeof handlers["organization.created"]).toBe("function");
    expect(typeof handlers["organization.provisioned"]).toBe("function");
    expect(typeof handlers["organization.discovery_requested"]).toBe("function");
    expect(typeof handlers["organization.discovered"]).toBe("function");
  });

  it("rejects duplicate registrations", () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });

    expect(() =>
      catalog.register("lead.created", async () => ({
        status: "completed",
        output: null,
        errors: [],
      })),
    ).toThrow(/already registered/i);
  });

  it("resolves handlers and rejects unknown types", () => {
    const catalog = new BusinessEventCatalog();
    catalog.register("lead.created", async () => ({
      status: "completed",
      output: null,
      errors: [],
    }));

    expect(typeof catalog.resolve("lead.created")).toBe("function");
    expect(catalog.tryResolve("organization.created")).toBeNull();
    expect(() => catalog.resolve("organization.created")).toThrow(
      /not registered/i,
    );
  });

  it("exposes the canonical Lead Qualification Workflow id", () => {
    expect(DEFAULT_LEAD_QUALIFICATION_WORKFLOW_ID).toBe(
      "wf_lead_qualification",
    );
  });

  it("returns rejected outcome when provisioning handler is missing", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
    });

    const event: BusinessEvent = {
      eventId: "evt_001",
      type: "organization.created",
      occurredAt: new Date(),
      organizationId: "org_demo",
      workspaceId: "wsp_demo",
      organizationName: "Departify",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.created"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.errors[0]?.code).toBe("BUSINESS_EVENT_REJECTED");
  });

  it("returns an empty catalog for createBusinessEventCatalog with no handlers", () => {
    const catalog = createBusinessEventCatalog();
    expect(catalog.size()).toBe(0);
    expect(catalog.list()).toEqual([]);
  });

  it("returns a controlled rejection when the discovery workflow is missing", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
    });

    const event: BusinessEvent = {
      eventId: "evt_disc_001",
      type: "organization.discovery_requested",
      occurredAt: new Date(),
      organizationId: "org_demo",
      requestedBy: "tester",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.discovery_requested"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.errors[0]?.code).toBe("BUSINESS_EVENT_REJECTED");
    expect(outcome.errors[0]?.message).toMatch(/discovery workflow/i);
  });

  it("returns a controlled rejection when the discovery completion handler is missing", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
    });

    const event: BusinessEvent = {
      eventId: "evt_disc_done_001",
      type: "organization.discovered",
      occurredAt: new Date(),
      organizationId: "org_demo",
      sessionId: "session_001",
      discoveryExecutionId: "exe_disc_001",
      confidence: "low",
      gapCount: 14,
      questionCount: 20,
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.discovered"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.errors[0]?.code).toBe("BUSINESS_EVENT_REJECTED");
    expect(outcome.errors[0]?.message).toMatch(/completion handler|department service/i);
  });

  it("associates the discovery to the organization's departments by default", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const departmentService = createDepartmentService();
    departmentService.create({
      id: "dep_comercial",
      organizationId: "org_demo",
      name: "Comercial",
      description: "Sales department",
      configuration: {
        displayName: "Comercial",
        description: "Sales",
        tags: [],
        metadata: {},
      },
    });
    departmentService.activate("dep_comercial");
    // An archived department of the same org must be skipped.
    departmentService.create({
      id: "dep_legacy",
      organizationId: "org_demo",
      name: "Legacy",
      description: "Archived department",
      configuration: {
        displayName: "Legacy",
        description: "Legacy",
        tags: [],
        metadata: {},
      },
    });
    departmentService.archive("dep_legacy");
    // A department of another org must be skipped.
    departmentService.create({
      id: "dep_other_org",
      organizationId: "org_other",
      name: "Other",
      description: "Other org",
      configuration: {
        displayName: "Other",
        description: "Other",
        tags: [],
        metadata: {},
      },
    });

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      departmentService,
    });

    const event: BusinessEvent = {
      eventId: "evt_disc_done_assoc",
      type: "organization.discovered",
      occurredAt: new Date(),
      organizationId: "org_demo",
      sessionId: "session_001",
      discoveryExecutionId: "exe_disc_001",
      confidence: "low",
      gapCount: 14,
      questionCount: 20,
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.discovered"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("completed");
    const output = outcome.output as {
      associatedCount: number;
      departmentIds: string[];
    };
    expect(output.associatedCount).toBe(1);
    expect(output.departmentIds).toEqual(["dep_comercial"]);
    expect(departmentService.getDiscoveryId("dep_comercial")).toBe(
      "exe_disc_001",
    );
    expect(departmentService.getDiscoveryId("dep_legacy")).toBeNull();
    expect(departmentService.getDiscoveryId("dep_other_org")).toBeNull();
  });

  it("prefers the host-supplied completion handler over the department service fallback", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const departmentService = createDepartmentService();
    departmentService.create({
      id: "dep_comercial",
      organizationId: "org_demo",
      name: "Comercial",
      description: "Sales department",
      configuration: {
        displayName: "Comercial",
        description: "Sales",
        tags: [],
        metadata: {},
      },
    });

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      departmentService,
      discoveryCompletionHandler: async () => ({
        status: "completed",
        output: { custom: true },
        errors: [],
        executionId: "custom_exe",
      }),
    });

    const event: BusinessEvent = {
      eventId: "evt_disc_done_custom",
      type: "organization.discovered",
      occurredAt: new Date(),
      organizationId: "org_demo",
      sessionId: "session_001",
      discoveryExecutionId: "exe_disc_001",
      confidence: "low",
      gapCount: 14,
      questionCount: 20,
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.discovered"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("completed");
    expect((outcome.output as { custom: boolean }).custom).toBe(true);
    // The fallback must NOT have run.
    expect(departmentService.getDiscoveryId("dep_comercial")).toBeNull();
  });

  it("skips when the organization has no non-archived departments", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const departmentService = createDepartmentService();

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      departmentService,
    });

    const event: BusinessEvent = {
      eventId: "evt_disc_done_empty",
      type: "organization.discovered",
      occurredAt: new Date(),
      organizationId: "org_demo",
      sessionId: "session_001",
      discoveryExecutionId: "exe_disc_001",
      confidence: "low",
      gapCount: 14,
      questionCount: 20,
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.discovered"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("skipped");
    expect(
      (outcome.output as { associatedCount: number }).associatedCount,
    ).toBe(0);
  });

  it("runs the discovery workflow automatically after a successful provisioning", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const discoveryWorkflow = {
      run: async () => ({
        status: "completed" as const,
        workflowId: "wf_executive_discovery",
        executionId: "exe_disc_auto_001",
        report: { organizationId: "org_demo" },
        orchestration: null,
        discovery: { status: "completed" },
        startedAt: "2026-08-06T10:00:00Z",
        completedAt: "2026-08-06T10:00:01Z",
        durationMs: 1000,
        error: null,
      }),
    } as unknown as ExecutiveDiscoveryWorkflow;

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      discoveryWorkflow,
      provisioningHandler: async (event) => ({
        status: "completed",
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId: "prv_auto_001",
      }),
    });

    const event: BusinessEvent = {
      eventId: "evt_provisioned_auto",
      type: "organization.provisioned",
      occurredAt: new Date(),
      organizationId: "org_demo",
      workspaceId: "wsp_demo",
      provisioningId: "prv_auto_001",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.provisioned"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("completed");
    expect(outcome.workflowId).toBe("wf_department_onboarding");
    expect(outcome.executionId).toMatch(/^wfe_/);
    const output = outcome.output as {
      activation: { organizationId: string };
      discovery: { workflowId: string };
      onboarding: { workflowId: string };
    };
    expect(output.activation.organizationId).toBe("org_demo");
    expect(output.discovery.workflowId).toBe("wf_executive_discovery");
    expect(output.onboarding.workflowId).toBe("wf_department_onboarding");
  });

  it("does not run discovery when no discovery workflow is wired", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      provisioningHandler: async (event) => ({
        status: "completed",
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId: "prv_manual_001",
      }),
    });

    const event: BusinessEvent = {
      eventId: "evt_provisioned_manual",
      type: "organization.provisioned",
      occurredAt: new Date(),
      organizationId: "org_demo",
      workspaceId: "wsp_demo",
      provisioningId: "prv_manual_001",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.provisioned"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("completed");
    // The output shape stays the provisioning result only (retro-compatible).
    expect((outcome.output as { organizationId: string }).organizationId).toBe(
      "org_demo",
    );
    expect(outcome.workflowId).toBeUndefined();
    expect(outcome.executionId).toBeUndefined();
  });

  it("does not run discovery when provisioning fails", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const discoveryWorkflow = {
      run: async () => {
        throw new Error("must not run");
      },
    } as unknown as ExecutiveDiscoveryWorkflow;

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      discoveryWorkflow,
      provisioningHandler: async () => ({
        status: "failed",
        output: null,
        errors: [
          {
            code: "provisioning_failed",
            message: "provisioning exploded",
            phase: "execution",
          },
        ],
        provisioningId: "prv_fail_001",
      }),
    });

    const event: BusinessEvent = {
      eventId: "evt_provisioned_fail",
      type: "organization.provisioned",
      occurredAt: new Date(),
      organizationId: "org_demo",
      workspaceId: "wsp_demo",
      provisioningId: "prv_fail_001",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "organization.provisioned"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.errors[0]?.code).toBe("provisioning_failed");
  });

  it("creates the organization after a qualified lead when a creator is wired", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const organizationCreator: OrganizationCreator = async (event) => ({
      status: "completed",
      output: {
        organizationId: event.organizationId ?? "org_from_lead",
        workspaceId: "wsp_from_lead",
      },
      errors: [],
      provisioningId: "prv_from_lead",
    });

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      organizationCreator,
    });

    const event: BusinessEvent = {
      eventId: "evt_lead_qualified_auto",
      type: "lead.created",
      occurredAt: new Date(),
      organizationId: "org_from_lead",
      departmentId: "dep_comercial",
      leadId: "lead_qualified_001",
      contactEmail: "qualified@example.com",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers["lead.created"](
      event,
      {
        now: () => new Date(),
        eventId: () => "evt",
        workflowId: () => "wf",
        executionId: () => "wf_exec",
      },
    );

    expect(outcome.status).toBe("completed");
    const output = outcome.output as {
      qualification: { workflowId: string };
      organization: { organizationId: string };
    };
    expect(output.qualification.workflowId).toBe("wf_lead_qualification");
    expect(output.organization.organizationId).toBe("org_from_lead");
  });

  it("only qualifies the lead when no organization creator is wired", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
    });

    const event: BusinessEvent = {
      eventId: "evt_lead_manual",
      type: "lead.created",
      occurredAt: new Date(),
      organizationId: "org_manual",
      departmentId: "dep_comercial",
      leadId: "lead_manual_001",
      contactEmail: "manual@example.com",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers["lead.created"](
      event,
      {
        now: () => new Date(),
        eventId: () => "evt",
        workflowId: () => "wf",
        executionId: () => "wf_exec",
      },
    );

    expect(outcome.status).toBe("completed");
    // Retro-compatible shape: the qualification result only.
    const output = outcome.output as { workflowId: string };
    expect(output.workflowId).toBe("wf_lead_qualification");
  });

  it("does not create the organization when qualification fails", async () => {
    const failingPort: AgentToolPort = {
      executeAction: async () => {
        throw new Error("qualification exploded");
      },
    };
    const executor = new WorkflowExecution({ port: failingPort });
    let creatorInvoked = false;
    const organizationCreator: OrganizationCreator = async () => {
      creatorInvoked = true;
      return {
        status: "completed",
        output: null,
        errors: [],
      };
    };

    const handlers = buildDefaultCatalogHandlers({
      port: failingPort,
      workflowExecutor: executor,
      organizationCreator,
    });

    const event: BusinessEvent = {
      eventId: "evt_lead_fail",
      type: "lead.created",
      occurredAt: new Date(),
      organizationId: "org_fail",
      departmentId: "dep_comercial",
      leadId: "lead_fail_001",
      contactEmail: "fail@example.com",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers["lead.created"](
      event,
      {
        now: () => new Date(),
        eventId: () => "evt",
        workflowId: () => "wf",
        executionId: () => "wf_exec",
      },
    );

    expect(outcome.status).toBe("failed");
    expect(creatorInvoked).toBe(false);
  });

  it("creates the organization from a confirmed payment via the organization creator", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const organizationCreator: OrganizationCreator = async (event) => ({
      status: "completed",
      output: {
        organizationId: event.organizationId,
        paymentId: event.type === "payment.confirmed" ? event.paymentId : null,
      },
      errors: [],
      provisioningId: "prv_from_payment",
    });

    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
      organizationCreator,
    });

    const event: BusinessEvent = {
      eventId: "evt_payment_confirmed",
      type: "payment.confirmed",
      occurredAt: new Date(),
      paymentId: "pay_001",
      organizationId: "org_from_payment",
      planId: "plan_pro",
      customerEmail: "client@example.com",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "payment.confirmed"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("completed");
    const output = outcome.output as {
      organizationId: string;
      paymentId: string;
    };
    expect(output.organizationId).toBe("org_from_payment");
    expect(output.paymentId).toBe("pay_001");
  });

  it("rejects a confirmed payment when no organization creator is wired", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const handlers = buildDefaultCatalogHandlers({
      port,
      workflowExecutor: executor,
    });

    const event: BusinessEvent = {
      eventId: "evt_payment_rejected",
      type: "payment.confirmed",
      occurredAt: new Date(),
      paymentId: "pay_002",
      organizationId: "org_rejected",
      planId: "plan_basic",
      payload: {},
    };

    const outcome: BusinessEventHandlerOutcome = await handlers[
      "payment.confirmed"
    ](event, {
      now: () => new Date(),
      eventId: () => "evt",
      workflowId: () => "wf",
      executionId: () => "wf_exec",
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.errors[0]?.code).toBe("BUSINESS_EVENT_REJECTED");
    expect(outcome.errors[0]?.message).toMatch(/organization creator/i);
  });
});

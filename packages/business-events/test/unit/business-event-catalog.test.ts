import type {
  AgentToolPort,
  AgentToolAction,
  AgentToolActionResult,
} from "@departify/agent-tool-bridge";
import { WorkflowExecution } from "@departify/workflows";
import {
  BusinessEventCatalog,
  buildCanonicalCatalog,
  buildDefaultCatalogHandlers,
  createBusinessEventCatalog,
  DEFAULT_LEAD_QUALIFICATION_WORKFLOW_ID,
  type BusinessEvent,
  type BusinessEventHandlerOutcome,
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
  it("builds the canonical catalog with the three default handlers", () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog, handlers } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });

    expect(catalog.size()).toBe(3);
    expect(catalog.has("lead.created")).toBe(true);
    expect(catalog.has("organization.created")).toBe(true);
    expect(catalog.has("organization.provisioned")).toBe(true);
    expect([...catalog.list()].sort()).toEqual(
      [
        "lead.created",
        "organization.created",
        "organization.provisioned",
      ].sort(),
    );

    expect(typeof handlers["lead.created"]).toBe("function");
    expect(typeof handlers["organization.created"]).toBe("function");
    expect(typeof handlers["organization.provisioned"]).toBe("function");
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
});

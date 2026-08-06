import type {
  AgentToolPort,
  AgentToolAction,
  AgentToolActionResult,
} from "@departify/agent-tool-bridge";
import { WorkflowExecution } from "@departify/workflows";
import {
  BusinessEventService,
  buildCanonicalCatalog,
  businessEventTypes,
  createBusinessEventCatalog,
  type BusinessEvent,
} from "../../src/index.js";

class SuccessAgentToolPort implements AgentToolPort {
  readonly calls: AgentToolAction[] = [];

  async executeAction(action: AgentToolAction): Promise<AgentToolActionResult> {
    this.calls.push(action);
    const envelope: AgentToolActionResult = {
      actionId: action.actionId,
      requestId: action.actionId,
      toolId: action.toolId,
      toolVersion: "1.0.0",
      status: "completed",
      output: { uuid: "uuid_001" },
      durationMs: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return envelope;
  }
}

function leadCreatedEvent(): BusinessEvent {
  return {
    eventId: "evt_lead_001",
    type: "lead.created",
    occurredAt: new Date("2026-08-05T12:00:00Z"),
    organizationId: "org_departify",
    departmentId: "dep_comercial",
    leadId: "lead_001",
    contactEmail: "lead@example.com",
    payload: {},
  };
}

function organizationCreatedEvent(): BusinessEvent {
  return {
    eventId: "evt_org_001",
    type: "organization.created",
    occurredAt: new Date("2026-08-05T12:00:00Z"),
    organizationId: "org_departify",
    workspaceId: "wsp_primary",
    organizationName: "Departify",
    payload: {},
  };
}

describe("BusinessEventService", () => {
  it("publishes lead.created through the workflow execution pipeline", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });
    const service = new BusinessEventService({ catalog });

    const result = await service.publish(leadCreatedEvent());

    expect(result.status).toBe("completed");
    expect(result.eventType).toBe("lead.created");
    expect(result.workflowId).toBe("wf_lead_qualification");
    expect(result.executionId).toMatch(/^wfe_/);
    expect(result.departmentId).toBe("dep_comercial");
    expect(result.errors).toEqual([]);
    expect(port.calls).toHaveLength(3);
  });

  it("forwards organization.created to the provisioning handler", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      provisioningHandler: async () => ({
        status: "completed",
        output: { provisioningId: "prv_test_001" },
        errors: [],
        provisioningId: "prv_test_001",
      }),
    });
    const service = new BusinessEventService({ catalog });

    const result = await service.publish(organizationCreatedEvent());

    expect(result.status).toBe("completed");
    expect(result.provisioningId).toBe("prv_test_001");
    expect(result.errors).toEqual([]);
  });

  it("is idempotent: re-publishing the same event returns the cached result", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });
    const service = new BusinessEventService({ catalog });

    const event: BusinessEvent = leadCreatedEvent();
    const first = await service.publish(event);
    const second = await service.publish(event);

    expect(first.executionId).toBe(second.executionId);
    expect(second.idempotent).toBe(true);
    expect(port.calls).toHaveLength(3);
  });

  it("rejects invalid events with a typed validation envelope", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });
    const service = new BusinessEventService({ catalog });

    const result = await service.publish({
      eventId: "evt_bad",
      type: "unknown.event" as never,
      occurredAt: new Date(),
      payload: {},
    });

    expect(result.status).toBe("rejected");
    expect(result.errors[0]?.code).toBe("validation_failed");
    expect(result.errors[0]?.phase).toBe("validation");
  });

  it("rejects events whose type is not registered with the catalog", async () => {
    const emptyCatalog = createBusinessEventCatalog();
    const service = new BusinessEventService({
      catalog: emptyCatalog,
    });

    const result = await service.publish(leadCreatedEvent());

    expect(result.status).toBe("rejected");
    expect(result.errors[0]?.code).toBe("BUSINESS_EVENT_UNKNOWN");
    expect(result.errors[0]?.phase).toBe("catalog");
  });

  it("captures handler exceptions as delegation failures", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      provisioningHandler: async () => {
        throw new Error("provisioning exploded");
      },
    });
    const service = new BusinessEventService({ catalog });

    const result = await service.publish(organizationCreatedEvent());

    expect(result.status).toBe("failed");
    expect(result.errors[0]?.code).toBe("delegation_failed");
    expect(result.errors[0]?.phase).toBe("delegation");
    expect(result.errors[0]?.message).toContain("provisioning exploded");
  });

  it("exposes the canonical event types as a typed list", () => {
    expect(businessEventTypes).toEqual([
      "payment.confirmed",
      "lead.created",
      "organization.created",
      "organization.provisioned",
      "organization.discovery_requested",
      "organization.discovered",
    ]);
  });

  it("returns null from getResult / replay for unknown event ids", async () => {
    const port = new SuccessAgentToolPort();
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });
    const service = new BusinessEventService({ catalog });
    expect(service.getResult("evt_missing")).toBeNull();
    expect(service.replay("evt_missing")).toBeNull();
  });
});

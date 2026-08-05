import type {
  AssignTaskIntent,
  CreateOrganizationIntent,
  RequestAgentIntent,
  RequestDepartmentIntent,
} from "../src/index.js";

export function createOrganizationIntent(): CreateOrganizationIntent {
  return {
    type: "create_organization",
    intentId: "int_create_org_001",
    requestedBy: "usr_admin001",
    organizationName: "Departify",
    occurredAt: new Date("2026-08-05T00:00:00.000Z"),
  };
}

export function assignTaskIntent(): AssignTaskIntent {
  return {
    type: "assign_task",
    intentId: "int_assign_task_001",
    requestedBy: "usr_admin001",
    organizationId: "org_departify01",
    taskId: "tsk_001",
    targetAgentId: "agt_operations01",
    title: "Review onboarding checklist",
  };
}

export function requestDepartmentIntent(): RequestDepartmentIntent {
  return {
    type: "request_department",
    intentId: "int_request_department_001",
    requestedBy: "usr_admin001",
    organizationId: "org_departify01",
    departmentName: "Finance",
    purpose: "Coordinate financial operations",
  };
}

export function requestAgentIntent(): RequestAgentIntent {
  return {
    type: "request_agent",
    intentId: "int_request_agent_001",
    requestedBy: "usr_admin001",
    organizationId: "org_departify01",
    departmentId: "dep_finance001",
    agentName: "Finance Coordinator",
    agentRole: "finance-coordinator",
  };
}

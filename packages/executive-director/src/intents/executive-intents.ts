export const executiveIntentTypes = [
  "create_organization",
  "activate_organization",
  "pause_organization",
  "resume_organization",
  "assign_task",
  "request_department",
  "request_agent",
] as const;

export type ExecutiveIntentType = (typeof executiveIntentTypes)[number];

export interface ExecutiveIntentBase<TType extends ExecutiveIntentType> {
  type: TType;
  intentId: string;
  requestedBy: string;
  organizationId?: string;
  occurredAt?: Date;
  metadata?: Readonly<Record<string, string>>;
}

export interface CreateOrganizationIntent extends ExecutiveIntentBase<"create_organization"> {
  organizationName: string;
}

export interface ActivateOrganizationIntent extends ExecutiveIntentBase<"activate_organization"> {
  organizationId: string;
}

export interface PauseOrganizationIntent extends ExecutiveIntentBase<"pause_organization"> {
  organizationId: string;
  reason: string;
}

export interface ResumeOrganizationIntent extends ExecutiveIntentBase<"resume_organization"> {
  organizationId: string;
}

export interface AssignTaskIntent extends ExecutiveIntentBase<"assign_task"> {
  organizationId: string;
  taskId: string;
  targetAgentId?: string;
  targetDepartmentId?: string;
  title: string;
}

export interface RequestDepartmentIntent extends ExecutiveIntentBase<"request_department"> {
  organizationId: string;
  departmentName: string;
  purpose: string;
}

export interface RequestAgentIntent extends ExecutiveIntentBase<"request_agent"> {
  organizationId: string;
  departmentId: string;
  agentName: string;
  agentRole: string;
}

export type ExecutiveIntent =
  | CreateOrganizationIntent
  | ActivateOrganizationIntent
  | PauseOrganizationIntent
  | ResumeOrganizationIntent
  | AssignTaskIntent
  | RequestDepartmentIntent
  | RequestAgentIntent;

import type {
  BusinessDepartmentId,
  BusinessEventId,
  BusinessEventType,
  BusinessOrganizationId,
} from "./business-event-types.js";

/**
 * Typed outcome envelope returned by the `BusinessEventService`. Preserves
 * the full correlation chain (intent → workflow → execution) plus
 * timestamps and structured errors.
 */
export type BusinessEventStatus =
  "completed" | "failed" | "rejected" | "skipped";

export interface BusinessEventError {
  readonly code: string;
  readonly message: string;
  readonly phase: "validation" | "catalog" | "delegation" | "execution";
}

export interface BusinessEventResult {
  readonly eventId: BusinessEventId;
  readonly eventType: BusinessEventType;
  readonly organizationId?: BusinessOrganizationId;
  readonly departmentId?: BusinessDepartmentId;
  readonly workflowId?: string;
  readonly executionId?: string;
  readonly provisioningId?: string;
  readonly status: BusinessEventStatus;
  readonly output: unknown;
  readonly errors: readonly BusinessEventError[];
  readonly idempotent: boolean;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export function buildBusinessEventResult(input: {
  eventId: BusinessEventId;
  eventType: BusinessEventType;
  status: BusinessEventStatus;
  organizationId?: BusinessOrganizationId;
  departmentId?: BusinessDepartmentId;
  workflowId?: string;
  executionId?: string;
  provisioningId?: string;
  output: unknown;
  errors: readonly BusinessEventError[];
  idempotent: boolean;
  startedAt: Date;
  completedAt: Date;
}): BusinessEventResult {
  return {
    eventId: input.eventId,
    eventType: input.eventType,
    ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    ...(input.provisioningId ? { provisioningId: input.provisioningId } : {}),
    status: input.status,
    output: input.output,
    errors: input.errors,
    idempotent: input.idempotent,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
  };
}

import {
  departmentStatuses,
  type AgentId,
  type DepartmentConfiguration,
  type DepartmentConnection,
  type DepartmentConnectionKind,
  type DepartmentDescription,
  type DepartmentId,
  type DepartmentMetricsSnapshot,
  type DepartmentName,
  type DepartmentSnapshot,
  type DepartmentStatus,
  type DiscoveryId,
  type KnowledgeCollectionId,
  type MemorySessionId,
  type ToolId,
} from "./department-types.js";

/**
 * Pure validation helpers for the Department domain. The aggregate uses
 * these to guarantee its invariants without depending on any runtime.
 */

const departmentIdPattern = /^dep_[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;

export function assertDepartmentDomainInvariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new DepartmentDomainInvariantError(message);
  }
}

export class DepartmentDomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepartmentDomainInvariantError";
  }
}

export function validateDepartmentId(value: unknown): DepartmentId {
  assertDepartmentDomainInvariant(
    typeof value === "string" && value.trim().length > 0,
    "Department id must be a non-empty string.",
  );
  const trimmed = value.trim();
  assertDepartmentDomainInvariant(
    departmentIdPattern.test(trimmed),
    "Department id must start with dep_ and contain 6 to 64 safe characters.",
  );
  return trimmed;
}

export function validateDepartmentName(value: unknown): DepartmentName {
  assertDepartmentDomainInvariant(
    typeof value === "string" && value.trim().length >= 2,
    "Department name must contain at least 2 characters.",
  );
  return value.trim();
}

export function validateDepartmentDescription(
  value: unknown,
): DepartmentDescription {
  assertDepartmentDomainInvariant(
    typeof value === "string",
    "Department description must be a string.",
  );
  return value.trim();
}

export function validateOrganizationId(value: unknown): string {
  assertDepartmentDomainInvariant(
    typeof value === "string" && value.trim().length > 0,
    "Organization id is required.",
  );
  return value.trim();
}

export function validateDepartmentStatus(value: unknown): DepartmentStatus {
  assertDepartmentDomainInvariant(
    typeof value === "string",
    "Department status must be a string.",
  );
  assertDepartmentDomainInvariant(
    departmentStatuses.includes(value as DepartmentStatus),
    `Department status '${String(value)}' is invalid.`,
  );
  return value as DepartmentStatus;
}

export function validateConfiguration(value: unknown): DepartmentConfiguration {
  assertDepartmentDomainInvariant(
    typeof value === "object" && value !== null,
    "Department configuration must be an object.",
  );
  const candidate = value as Record<string, unknown>;
  const displayName = assertNonEmptyString(
    candidate.displayName,
    "configuration.displayName",
  );
  const description = assertNonEmptyString(
    candidate.description,
    "configuration.description",
  );
  const tags = Array.isArray(candidate.tags)
    ? (candidate.tags.filter((tag) => typeof tag === "string") as string[])
    : [];
  const metadata =
    typeof candidate.metadata === "object" && candidate.metadata !== null
      ? (candidate.metadata as Record<string, string>)
      : {};

  return {
    displayName,
    description,
    tags,
    metadata,
  };
}

export function validateAgentId(value: unknown, field: string): AgentId {
  assertDepartmentDomainInvariant(
    typeof value === "string" && value.trim().length > 0,
    `${field} must be a non-empty string.`,
  );
  return value.trim();
}

export function validateToolId(value: unknown): ToolId {
  return validateAgentId(value, "Tool id");
}

export function validateKnowledgeCollectionId(
  value: unknown,
): KnowledgeCollectionId {
  return validateAgentId(value, "Knowledge collection id");
}

export function validateMemorySessionId(value: unknown): MemorySessionId {
  return validateAgentId(value, "Memory session id");
}

export function validateDiscoveryId(value: unknown): DiscoveryId {
  return validateAgentId(value, "Discovery id");
}

export function validateConnections(
  value: unknown,
): readonly DepartmentConnection[] {
  if (value === undefined || value === null) {
    return [];
  }
  assertDepartmentDomainInvariant(
    Array.isArray(value),
    "Department connections must be an array.",
  );
  const result: DepartmentConnection[] = [];
  for (const entry of value) {
    assertDepartmentDomainInvariant(
      typeof entry === "object" && entry !== null,
      "Each connection must be an object.",
    );
    const obj = entry as Record<string, unknown>;
    const kind = obj.kind as DepartmentConnectionKind;
    assertDepartmentDomainInvariant(
      kind === "tool" ||
        kind === "knowledge_collection" ||
        kind === "memory_session" ||
        kind === "connected_application",
      `Connection kind '${String(obj.kind)}' is invalid.`,
    );
    const referenceId = assertNonEmptyString(
      obj.referenceId,
      "connection.referenceId",
    );
    result.push({
      kind,
      referenceId,
      ...(typeof obj.label === "string" && obj.label.length > 0
        ? { label: obj.label }
        : {}),
    });
  }
  return result;
}

export function computeMetrics(input: {
  employeeAgentIds: readonly AgentId[];
  connections: readonly DepartmentConnection[];
}): DepartmentMetricsSnapshot {
  const toolCount = input.connections.filter((c) => c.kind === "tool").length;
  const knowledgeCollectionCount = input.connections.filter(
    (c) => c.kind === "knowledge_collection",
  ).length;
  const memorySessionCount = input.connections.filter(
    (c) => c.kind === "memory_session",
  ).length;
  const connectedApplicationCount = input.connections.filter(
    (c) => c.kind === "connected_application",
  ).length;
  return {
    employeeCount: input.employeeAgentIds.length,
    toolCount,
    knowledgeCollectionCount,
    memorySessionCount,
    connectedApplicationCount,
  };
}

function assertNonEmptyString(value: unknown, field: string): string {
  assertDepartmentDomainInvariant(
    typeof value === "string" && value.trim().length > 0,
    `${field} must be a non-empty string.`,
  );
  return value.trim();
}

export function validateWorkflowId(value: unknown): string {
  assertDepartmentDomainInvariant(
    typeof value === "string" && value.trim().length > 0,
    "Workflow id must be a non-empty string.",
  );
  return value.trim();
}

export type { DepartmentSnapshot };

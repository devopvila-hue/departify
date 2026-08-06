/**
 * Public value-object identifiers for the Department boundary.
 *
 * Identifiers are typed strings so the Department aggregate stays
 * provider-neutral and host-independent. Consumers compose whatever IDs
 * make sense for their context (organization, request, correlation).
 */
export type DepartmentId = string;
export type DepartmentName = string;
export type DepartmentDescription = string;

/**
 * Identifiers used by reference. Departments only own references; the
 * authoritative state lives in the corresponding runtime package.
 */
export type AgentId = string;
export type KnowledgeCollectionId = string;
export type MemorySessionId = string;
export type ToolId = string;
export type ConnectedApplicationId = string;

/**
 * Basic metrics captured by the Department aggregate. These are computed
 * from composition state (employee count, tool count, knowledge count,
 * memory count) and never reach into runtime telemetry.
 */
export interface DepartmentMetricsSnapshot {
  readonly employeeCount: number;
  readonly toolCount: number;
  readonly knowledgeCollectionCount: number;
  readonly memorySessionCount: number;
  readonly connectedApplicationCount: number;
}

/**
 * Configuration block attached to a Department. Pure typed metadata; the
 * Department never interprets the keys.
 */
export interface DepartmentConfiguration {
  readonly displayName: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * Connection target. Pure typed reference — Departments never mutate the
 * referenced runtime state. They only carry the references.
 */
export type DepartmentConnectionKind =
  "tool" | "knowledge_collection" | "memory_session" | "connected_application";

export interface DepartmentConnection {
  readonly kind: DepartmentConnectionKind;
  readonly referenceId: string;
  readonly label?: string;
}

/**
 * Department lifecycle states. Sprint 24 keeps the surface minimal:
 * provisioning-style states plus archived as terminal.
 */
export const departmentStatuses = [
  "draft",
  "active",
  "paused",
  "archived",
] as const;

export type DepartmentStatus = (typeof departmentStatuses)[number];

/**
 * Snapshot of a Department aggregate. Used for serialisation and
 * composition reads.
 */
export interface DepartmentSnapshot {
  readonly id: DepartmentId;
  readonly organizationId: string;
  readonly name: DepartmentName;
  readonly description: DepartmentDescription;
  readonly configuration: DepartmentConfiguration;
  readonly directorAgentId: AgentId | null;
  readonly employeeAgentIds: readonly AgentId[];
  readonly connections: readonly DepartmentConnection[];
  readonly status: DepartmentStatus;
  readonly metrics: DepartmentMetricsSnapshot;
  readonly workflowIds: readonly WorkflowId[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type WorkflowId = string;

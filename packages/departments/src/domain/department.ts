import { assertDepartmentTransition } from "./department-lifecycle.js";
import {
  assertDepartmentDomainInvariant,
  computeMetrics,
  validateAgentId,
  validateConfiguration,
  validateDepartmentDescription,
  validateDepartmentId,
  validateDepartmentName,
  validateDepartmentStatus,
  validateKnowledgeCollectionId,
  validateMemorySessionId,
  validateOrganizationId,
  validateToolId,
  validateWorkflowId,
} from "./department-validation.js";
import type {
  AgentId,
  DepartmentConfiguration,
  DepartmentConnection,
  DepartmentConnectionKind,
  DepartmentDescription,
  DepartmentId,
  DepartmentMetricsSnapshot,
  DepartmentName,
  DepartmentSnapshot,
  DepartmentStatus,
  KnowledgeCollectionId,
  MemorySessionId,
  ToolId,
  WorkflowId,
} from "./department-types.js";

/**
 * Domain events emitted by the Department aggregate. Events are pure data
 * and consumed by hosts through `pullDepartmentEvents()`.
 */
export const departmentEventTypes = [
  "department.created",
  "department.activated",
  "department.paused",
  "department.archived",
  "department.employee_added",
  "department.employee_removed",
  "department.tool_associated",
  "department.tool_dissociated",
  "department.knowledge_associated",
  "department.knowledge_dissociated",
  "department.memory_associated",
  "department.memory_dissociated",
  "department.director_assigned",
  "department.workflow_attached",
  "department.workflow_detached",
] as const;

export type DepartmentEventType = (typeof departmentEventTypes)[number];

export interface DepartmentEventBase {
  readonly type: DepartmentEventType;
  readonly departmentId: DepartmentId;
  readonly occurredAt: Date;
}

export interface DepartmentCreatedEvent extends DepartmentEventBase {
  readonly type: "department.created";
  readonly organizationId: string;
}

export interface DepartmentActivatedEvent extends DepartmentEventBase {
  readonly type: "department.activated";
}

export interface DepartmentPausedEvent extends DepartmentEventBase {
  readonly type: "department.paused";
}

export interface DepartmentArchivedEvent extends DepartmentEventBase {
  readonly type: "department.archived";
}

export interface DepartmentEmployeeAddedEvent extends DepartmentEventBase {
  readonly type: "department.employee_added";
  readonly agentId: AgentId;
}

export interface DepartmentEmployeeRemovedEvent extends DepartmentEventBase {
  readonly type: "department.employee_removed";
  readonly agentId: AgentId;
}

export interface DepartmentToolAssociatedEvent extends DepartmentEventBase {
  readonly type: "department.tool_associated";
  readonly toolId: ToolId;
}

export interface DepartmentToolDissociatedEvent extends DepartmentEventBase {
  readonly type: "department.tool_dissociated";
  readonly toolId: ToolId;
}

export interface DepartmentKnowledgeAssociatedEvent extends DepartmentEventBase {
  readonly type: "department.knowledge_associated";
  readonly collectionId: KnowledgeCollectionId;
}

export interface DepartmentKnowledgeDissociatedEvent extends DepartmentEventBase {
  readonly type: "department.knowledge_dissociated";
  readonly collectionId: KnowledgeCollectionId;
}

export interface DepartmentMemoryAssociatedEvent extends DepartmentEventBase {
  readonly type: "department.memory_associated";
  readonly sessionId: MemorySessionId;
}

export interface DepartmentMemoryDissociatedEvent extends DepartmentEventBase {
  readonly type: "department.memory_dissociated";
  readonly sessionId: MemorySessionId;
}

export interface DepartmentDirectorAssignedEvent extends DepartmentEventBase {
  readonly type: "department.director_assigned";
  readonly agentId: AgentId;
}

export interface DepartmentWorkflowAttachedEvent extends DepartmentEventBase {
  readonly type: "department.workflow_attached";
  readonly workflowId: string;
}

export interface DepartmentWorkflowDetachedEvent extends DepartmentEventBase {
  readonly type: "department.workflow_detached";
  readonly workflowId: string;
}

export type DepartmentEvent =
  | DepartmentCreatedEvent
  | DepartmentActivatedEvent
  | DepartmentPausedEvent
  | DepartmentArchivedEvent
  | DepartmentEmployeeAddedEvent
  | DepartmentEmployeeRemovedEvent
  | DepartmentToolAssociatedEvent
  | DepartmentToolDissociatedEvent
  | DepartmentKnowledgeAssociatedEvent
  | DepartmentKnowledgeDissociatedEvent
  | DepartmentMemoryAssociatedEvent
  | DepartmentMemoryDissociatedEvent
  | DepartmentDirectorAssignedEvent
  | DepartmentWorkflowAttachedEvent
  | DepartmentWorkflowDetachedEvent;

/**
 * Department aggregate. Composes references to existing components
 * (Agent Runtime, Tool Catalog, Knowledge Engine, Memory Engine,
 * Executive Director) but never duplicates their state or behavior.
 */
export interface CreateDepartmentInput {
  readonly id: unknown;
  readonly organizationId: unknown;
  readonly name: unknown;
  readonly description?: unknown;
  readonly configuration?: unknown;
  readonly directorAgentId?: unknown;
  readonly initialEmployeeAgentIds?: readonly unknown[];
  readonly initialConnections?: readonly unknown[];
  readonly occurredAt?: Date;
}

export class Department {
  private readonly events: DepartmentEvent[] = [];

  private constructor(
    private readonly id: DepartmentId,
    private readonly organizationId: string,
    private name: DepartmentName,
    private description: DepartmentDescription,
    private configuration: DepartmentConfiguration,
    private directorAgentId: AgentId | null,
    private readonly employeeAgentIds: Set<AgentId>,
    private readonly connections: Set<string>,
    private readonly connectionsByKind: Map<
      DepartmentConnectionKind,
      Set<string>
    >,
    private readonly workflowIds: Set<WorkflowId>,
    private status: DepartmentStatus,
    private readonly createdAt: Date,
    private updatedAt: Date,
  ) {}

  static create(input: CreateDepartmentInput): Department {
    const id = validateDepartmentId(input.id);
    const organizationId = validateOrganizationId(input.organizationId);
    const name = validateDepartmentName(input.name);
    const description = validateDepartmentDescription(input.description ?? "");
    const configuration = validateConfiguration(
      input.configuration ?? {
        displayName: name,
        description,
        tags: [],
        metadata: {},
      },
    );
    const directorAgentId =
      input.directorAgentId === undefined || input.directorAgentId === null
        ? null
        : validateAgentId(input.directorAgentId, "directorAgentId");

    const department = new Department(
      id,
      organizationId,
      name,
      description,
      configuration,
      directorAgentId,
      new Set<AgentId>(),
      new Set<string>(),
      new Map<DepartmentConnectionKind, Set<string>>([
        ["tool", new Set<string>()],
        ["knowledge_collection", new Set<string>()],
        ["memory_session", new Set<string>()],
        ["connected_application", new Set<string>()],
      ]),
      new Set<WorkflowId>(),
      "draft",
      input.occurredAt ?? new Date(),
      input.occurredAt ?? new Date(),
    );

    department.record({
      type: "department.created",
      departmentId: id,
      organizationId,
      occurredAt: department.createdAt,
    });

    if (directorAgentId) {
      department.record({
        type: "department.director_assigned",
        departmentId: id,
        agentId: directorAgentId,
        occurredAt: department.createdAt,
      });
    }

    if (input.initialEmployeeAgentIds) {
      for (const candidate of input.initialEmployeeAgentIds) {
        department.addEmployee(candidate as AgentId, department.createdAt);
      }
    }
    if (input.initialConnections) {
      for (const entry of input.initialConnections) {
        const candidate = entry as {
          kind: DepartmentConnectionKind;
          referenceId: string;
          label?: string;
        };
        department.upsertConnection(candidate, department.createdAt);
      }
    }

    return department;
  }

  static reconstitute(snapshot: DepartmentSnapshot): Department {
    const department = new Department(
      validateDepartmentId(snapshot.id),
      validateOrganizationId(snapshot.organizationId),
      validateDepartmentName(snapshot.name),
      validateDepartmentDescription(snapshot.description),
      validateConfiguration(snapshot.configuration),
      snapshot.directorAgentId
        ? validateAgentId(snapshot.directorAgentId, "directorAgentId")
        : null,
      new Set<AgentId>(snapshot.employeeAgentIds),
      new Set<string>(
        snapshot.connections.map((c) => `${c.kind}:${c.referenceId}`),
      ),
      buildConnectionsByKind(snapshot.connections),
      new Set<WorkflowId>(snapshot.workflowIds),
      validateDepartmentStatus(snapshot.status),
      snapshot.createdAt,
      snapshot.updatedAt,
    );
    return department;
  }

  getId(): DepartmentId {
    return this.id;
  }

  getStatus(): DepartmentStatus {
    return this.status;
  }

  getOrganizationId(): string {
    return this.organizationId;
  }

  getDirectorAgentId(): AgentId | null {
    return this.directorAgentId;
  }

  listEmployees(): readonly AgentId[] {
    return [...this.employeeAgentIds];
  }

  listConnections(): readonly DepartmentConnection[] {
    const result: DepartmentConnection[] = [];
    for (const entry of this.connections) {
      const [kind, referenceId] = entry.split(":", 2) as [
        DepartmentConnectionKind,
        string,
      ];
      result.push({ kind, referenceId });
    }
    return result;
  }

  listTools(): readonly ToolId[] {
    return this.byKind("tool");
  }

  listKnowledgeCollections(): readonly KnowledgeCollectionId[] {
    return this.byKind("knowledge_collection");
  }

  listMemorySessions(): readonly MemorySessionId[] {
    return this.byKind("memory_session");
  }

  listConnectedApplications(): readonly string[] {
    return this.byKind("connected_application");
  }

  listWorkflows(): readonly WorkflowId[] {
    return [...this.workflowIds];
  }

  attachWorkflow(workflowId: WorkflowId, occurredAt = new Date()): void {
    this.assertMutable();
    const validated = validateWorkflowId(workflowId);
    if (this.workflowIds.has(validated)) {
      return;
    }
    this.workflowIds.add(validated);
    this.touch();
    this.record({
      type: "department.workflow_attached",
      departmentId: this.id,
      workflowId: validated,
      occurredAt,
    });
  }

  detachWorkflow(workflowId: WorkflowId, occurredAt = new Date()): void {
    this.assertMutable();
    const validated = validateWorkflowId(workflowId);
    if (!this.workflowIds.has(validated)) {
      return;
    }
    this.workflowIds.delete(validated);
    this.touch();
    this.record({
      type: "department.workflow_detached",
      departmentId: this.id,
      workflowId: validated,
      occurredAt,
    });
  }

  getMetrics(): DepartmentMetricsSnapshot {
    return computeMetrics({
      employeeAgentIds: this.listEmployees(),
      connections: this.listConnections(),
    });
  }

  rename(name: DepartmentName): void {
    this.assertMutable();
    this.name = validateDepartmentName(name);
    this.touch();
  }

  updateDescription(description: DepartmentDescription): void {
    this.assertMutable();
    this.description = validateDepartmentDescription(description);
    this.touch();
  }

  updateConfiguration(configuration: DepartmentConfiguration): void {
    this.assertMutable();
    this.configuration = validateConfiguration(configuration);
    this.touch();
  }

  assignDirector(agentId: AgentId, occurredAt = new Date()): void {
    this.assertMutable();
    const validated = validateAgentId(agentId, "directorAgentId");
    if (!this.employeeAgentIds.has(validated)) {
      this.addEmployee(validated, occurredAt);
    }
    this.directorAgentId = validated;
    this.record({
      type: "department.director_assigned",
      departmentId: this.id,
      agentId: validated,
      occurredAt,
    });
    this.touch();
  }

  addEmployee(agentId: AgentId, occurredAt = new Date()): void {
    this.assertMutable();
    const validated = validateAgentId(agentId, "agentId");
    if (this.employeeAgentIds.has(validated)) {
      return;
    }
    this.employeeAgentIds.add(validated);
    this.record({
      type: "department.employee_added",
      departmentId: this.id,
      agentId: validated,
      occurredAt,
    });
    this.touch();
  }

  removeEmployee(agentId: AgentId, occurredAt = new Date()): void {
    this.assertMutable();
    const validated = validateAgentId(agentId, "agentId");
    if (!this.employeeAgentIds.has(validated)) {
      return;
    }
    if (this.directorAgentId === validated) {
      this.directorAgentId = null;
    }
    this.employeeAgentIds.delete(validated);
    this.record({
      type: "department.employee_removed",
      departmentId: this.id,
      agentId: validated,
      occurredAt,
    });
    this.touch();
  }

  associateTool(toolId: ToolId, occurredAt = new Date()): void {
    this.assertMutable();
    const validated = validateToolId(toolId);
    if (this.upsertInKind("tool", validated)) {
      this.record({
        type: "department.tool_associated",
        departmentId: this.id,
        toolId: validated,
        occurredAt,
      });
      this.touch();
    }
  }

  dissociateTool(toolId: ToolId, occurredAt = new Date()): void {
    this.assertMutable();
    const validated = validateToolId(toolId);
    if (this.removeFromKind("tool", validated)) {
      this.record({
        type: "department.tool_dissociated",
        departmentId: this.id,
        toolId: validated,
        occurredAt,
      });
      this.touch();
    }
  }

  associateKnowledgeCollection(
    collectionId: KnowledgeCollectionId,
    occurredAt = new Date(),
  ): void {
    this.assertMutable();
    const validated = validateKnowledgeCollectionId(collectionId);
    if (this.upsertInKind("knowledge_collection", validated)) {
      this.record({
        type: "department.knowledge_associated",
        departmentId: this.id,
        collectionId: validated,
        occurredAt,
      });
      this.touch();
    }
  }

  dissociateKnowledgeCollection(
    collectionId: KnowledgeCollectionId,
    occurredAt = new Date(),
  ): void {
    this.assertMutable();
    const validated = validateKnowledgeCollectionId(collectionId);
    if (this.removeFromKind("knowledge_collection", validated)) {
      this.record({
        type: "department.knowledge_dissociated",
        departmentId: this.id,
        collectionId: validated,
        occurredAt,
      });
      this.touch();
    }
  }

  associateMemorySession(
    sessionId: MemorySessionId,
    occurredAt = new Date(),
  ): void {
    this.assertMutable();
    const validated = validateMemorySessionId(sessionId);
    if (this.upsertInKind("memory_session", validated)) {
      this.record({
        type: "department.memory_associated",
        departmentId: this.id,
        sessionId: validated,
        occurredAt,
      });
      this.touch();
    }
  }

  dissociateMemorySession(
    sessionId: MemorySessionId,
    occurredAt = new Date(),
  ): void {
    this.assertMutable();
    const validated = validateMemorySessionId(sessionId);
    if (this.removeFromKind("memory_session", validated)) {
      this.record({
        type: "department.memory_dissociated",
        departmentId: this.id,
        sessionId: validated,
        occurredAt,
      });
      this.touch();
    }
  }

  activate(occurredAt = new Date()): void {
    assertDepartmentTransition(this.status, "active");
    this.status = "active";
    this.record({
      type: "department.activated",
      departmentId: this.id,
      occurredAt,
    });
    this.touch();
  }

  pause(occurredAt = new Date()): void {
    assertDepartmentTransition(this.status, "paused");
    this.status = "paused";
    this.record({
      type: "department.paused",
      departmentId: this.id,
      occurredAt,
    });
    this.touch();
  }

  archive(occurredAt = new Date()): void {
    assertDepartmentTransition(this.status, "archived");
    this.status = "archived";
    this.record({
      type: "department.archived",
      departmentId: this.id,
      occurredAt,
    });
    this.touch();
  }

  pullDepartmentEvents(): readonly DepartmentEvent[] {
    const pulled = [...this.events];
    this.events.length = 0;
    return pulled;
  }

  toSnapshot(): DepartmentSnapshot {
    return {
      id: this.id,
      organizationId: this.organizationId,
      name: this.name,
      description: this.description,
      configuration: this.configuration,
      directorAgentId: this.directorAgentId,
      employeeAgentIds: this.listEmployees(),
      connections: this.listConnections(),
      status: this.status,
      metrics: this.getMetrics(),
      workflowIds: this.listWorkflows(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  private upsertConnection(
    connection: {
      kind: DepartmentConnectionKind;
      referenceId: string;
      label?: string;
    },
    occurredAt: Date,
  ): void {
    this.assertMutable();
    const kind = connection.kind;
    assertDepartmentDomainInvariant(
      kind === "tool" ||
        kind === "knowledge_collection" ||
        kind === "memory_session" ||
        kind === "connected_application",
      `Connection kind '${String(connection.kind)}' is invalid.`,
    );
    const referenceId =
      typeof connection.referenceId === "string" &&
      connection.referenceId.length > 0
        ? connection.referenceId
        : (() => {
            throw new Error("connection.referenceId is required");
          })();
    if (!this.upsertInKind(kind, referenceId)) {
      return;
    }
    switch (kind) {
      case "tool":
        this.record({
          type: "department.tool_associated",
          departmentId: this.id,
          toolId: referenceId,
          occurredAt,
        });
        break;
      case "knowledge_collection":
        this.record({
          type: "department.knowledge_associated",
          departmentId: this.id,
          collectionId: referenceId,
          occurredAt,
        });
        break;
      case "memory_session":
        this.record({
          type: "department.memory_associated",
          departmentId: this.id,
          sessionId: referenceId,
          occurredAt,
        });
        break;
      case "connected_application":
        // Connected applications are a placeholder — no event yet.
        break;
    }
    this.touch();
  }

  private byKind(kind: DepartmentConnectionKind): string[] {
    const set = this.connectionsByKind.get(kind);
    return set ? [...set] : [];
  }

  private upsertInKind(kind: DepartmentConnectionKind, id: string): boolean {
    const set = this.connectionsByKind.get(kind);
    if (!set) {
      return false;
    }
    if (set.has(id)) {
      return false;
    }
    set.add(id);
    this.connections.add(`${kind}:${id}`);
    return true;
  }

  private removeFromKind(kind: DepartmentConnectionKind, id: string): boolean {
    const set = this.connectionsByKind.get(kind);
    if (!set || !set.has(id)) {
      return false;
    }
    set.delete(id);
    this.connections.delete(`${kind}:${id}`);
    return true;
  }

  private assertMutable(): void {
    assertDepartmentDomainInvariant(
      this.status !== "archived",
      "Archived departments cannot be modified.",
    );
  }

  private touch(): void {
    this.updatedAt = new Date();
  }

  private record(event: DepartmentEvent): void {
    this.events.push(event);
  }
}

function buildConnectionsByKind(
  connections: readonly DepartmentConnection[],
): Map<DepartmentConnectionKind, Set<string>> {
  const map = new Map<DepartmentConnectionKind, Set<string>>([
    ["tool", new Set<string>()],
    ["knowledge_collection", new Set<string>()],
    ["memory_session", new Set<string>()],
    ["connected_application", new Set<string>()],
  ]);
  for (const connection of connections) {
    const set = map.get(connection.kind);
    if (set) {
      set.add(connection.referenceId);
    }
  }
  return map;
}

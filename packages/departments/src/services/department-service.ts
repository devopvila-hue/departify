import {
  Department,
  type CreateDepartmentInput,
  type DepartmentEvent,
} from "../domain/department.js";
import type {
  AgentId,
  DepartmentId,
  DepartmentSnapshot,
  DiscoveryId,
  KnowledgeCollectionId,
  MemorySessionId,
  ToolId,
  WorkflowId,
} from "../domain/department-types.js";

/**
 * DepartmentService — the single composition entry point for managing
 * Departments and their references to existing components.
 *
 * Pure service: no I/O, no SDKs, no HTTP. Hosts wire the service with
 * adapters of their choice (e.g., `@departify/agent-runtime` for the Agent
 * registry, `@departify/tool-runtime` for the Tool registry).
 */
export class DepartmentService {
  private readonly departments = new Map<DepartmentId, Department>();

  create(input: CreateDepartmentInput): Department {
    const department = Department.create(input);
    if (this.departments.has(department.getId())) {
      throw new Error(`Department '${department.getId()}' already exists.`);
    }
    this.departments.set(department.getId(), department);
    return department;
  }

  get(id: DepartmentId): Department {
    const department = this.departments.get(id);
    if (!department) {
      throw new Error(`Department '${id}' is not registered.`);
    }
    return department;
  }

  has(id: DepartmentId): boolean {
    return this.departments.has(id);
  }

  list(): readonly DepartmentSnapshot[] {
    return [...this.departments.values()].map((department) =>
      department.toSnapshot(),
    );
  }

  pullEvents(): readonly DepartmentEvent[] {
    const all: DepartmentEvent[] = [];
    for (const department of this.departments.values()) {
      all.push(...department.pullDepartmentEvents());
    }
    return all;
  }

  pullEventsFor(departmentId: DepartmentId): readonly DepartmentEvent[] {
    return this.get(departmentId).pullDepartmentEvents();
  }

  addEmployee(departmentId: DepartmentId, agentId: AgentId): Department {
    const department = this.get(departmentId);
    department.addEmployee(agentId);
    return department;
  }

  removeEmployee(departmentId: DepartmentId, agentId: AgentId): Department {
    const department = this.get(departmentId);
    department.removeEmployee(agentId);
    return department;
  }

  listEmployees(departmentId: DepartmentId): readonly AgentId[] {
    return this.get(departmentId).listEmployees();
  }

  associateTool(departmentId: DepartmentId, toolId: ToolId): Department {
    const department = this.get(departmentId);
    department.associateTool(toolId);
    return department;
  }

  dissociateTool(departmentId: DepartmentId, toolId: ToolId): Department {
    const department = this.get(departmentId);
    department.dissociateTool(toolId);
    return department;
  }

  associateKnowledgeCollection(
    departmentId: DepartmentId,
    collectionId: KnowledgeCollectionId,
  ): Department {
    const department = this.get(departmentId);
    department.associateKnowledgeCollection(collectionId);
    return department;
  }

  dissociateKnowledgeCollection(
    departmentId: DepartmentId,
    collectionId: KnowledgeCollectionId,
  ): Department {
    const department = this.get(departmentId);
    department.dissociateKnowledgeCollection(collectionId);
    return department;
  }

  associateMemorySession(
    departmentId: DepartmentId,
    sessionId: MemorySessionId,
  ): Department {
    const department = this.get(departmentId);
    department.associateMemorySession(sessionId);
    return department;
  }

  dissociateMemorySession(
    departmentId: DepartmentId,
    sessionId: MemorySessionId,
  ): Department {
    const department = this.get(departmentId);
    department.dissociateMemorySession(sessionId);
    return department;
  }

  assignDirector(departmentId: DepartmentId, agentId: AgentId): Department {
    const department = this.get(departmentId);
    department.assignDirector(agentId);
    return department;
  }

  activate(departmentId: DepartmentId): Department {
    const department = this.get(departmentId);
    department.activate();
    return department;
  }

  pause(departmentId: DepartmentId): Department {
    const department = this.get(departmentId);
    department.pause();
    return department;
  }

  archive(departmentId: DepartmentId): Department {
    const department = this.get(departmentId);
    department.archive();
    return department;
  }

  attachWorkflow(
    departmentId: DepartmentId,
    workflowId: WorkflowId,
  ): Department {
    const department = this.get(departmentId);
    department.attachWorkflow(workflowId);
    return department;
  }

  detachWorkflow(
    departmentId: DepartmentId,
    workflowId: WorkflowId,
  ): Department {
    const department = this.get(departmentId);
    department.detachWorkflow(workflowId);
    return department;
  }

  listWorkflows(departmentId: DepartmentId): readonly WorkflowId[] {
    return this.get(departmentId).listWorkflows();
  }

  associateDiscovery(departmentId: DepartmentId, discoveryId: DiscoveryId): Department {
    const department = this.get(departmentId);
    department.associateDiscovery(discoveryId);
    return department;
  }

  disassociateDiscovery(departmentId: DepartmentId): Department {
    const department = this.get(departmentId);
    department.disassociateDiscovery();
    return department;
  }

  getDiscoveryId(departmentId: DepartmentId): DiscoveryId | null {
    return this.get(departmentId).getDiscoveryId();
  }
}

/**
 * Convenience factory that returns a fresh service.
 */
export function createDepartmentService(): DepartmentService {
  return new DepartmentService();
}

export {
  Department,
  departmentEventTypes,
  type CreateDepartmentInput,
  type DepartmentActivatedEvent,
  type DepartmentArchivedEvent,
  type DepartmentCreatedEvent,
  type DepartmentDirectorAssignedEvent,
  type DepartmentEmployeeAddedEvent,
  type DepartmentEmployeeRemovedEvent,
  type DepartmentEvent,
  type DepartmentEventBase,
  type DepartmentEventType,
  type DepartmentKnowledgeAssociatedEvent,
  type DepartmentKnowledgeDissociatedEvent,
  type DepartmentMemoryAssociatedEvent,
  type DepartmentMemoryDissociatedEvent,
  type DepartmentPausedEvent,
  type DepartmentToolAssociatedEvent,
  type DepartmentToolDissociatedEvent,
} from "./domain/department.js";

export {
  assertDepartmentTransition,
  canDepartmentTransition,
} from "./domain/department-lifecycle.js";

export {
  assertDepartmentDomainInvariant,
  computeMetrics,
  DepartmentDomainInvariantError,
  validateAgentId,
  validateConfiguration,
  validateConnections,
  validateDepartmentDescription,
  validateDepartmentId,
  validateDepartmentName,
  validateDepartmentStatus,
  validateKnowledgeCollectionId,
  validateMemorySessionId,
  validateOrganizationId,
  validateToolId,
} from "./domain/department-validation.js";

export {
  type AgentId,
  type ConnectedApplicationId,
  type DepartmentConfiguration,
  type DepartmentConnection,
  type DepartmentConnectionKind,
  type DepartmentDescription,
  type DepartmentId,
  type DepartmentMetricsSnapshot,
  type DepartmentName,
  type DepartmentSnapshot,
  type DepartmentStatus,
  type KnowledgeCollectionId,
  type MemorySessionId,
  type ToolId,
  departmentStatuses,
} from "./domain/department-types.js";

export {
  DepartmentService,
  createDepartmentService,
} from "./services/department-service.js";

export { buildComercialDepartment } from "./demo/comercial.js";

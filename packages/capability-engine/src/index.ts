export {
  createCapabilityAction,
  readActionsOf,
  requiresApproval,
  writeActionsOf,
  type CapabilityAction,
  type CapabilityActionKind,
  type CapabilityApprovalPolicy,
  type CapabilityContract,
  type CapabilityHealth,
  type CapabilityRiskLevel,
  type CapabilitySource,
  type CapabilityStatus,
  type CapabilityVerification,
} from "./contracts/capability-contract.js";

export type {
  OperationalConnectionState,
  OperationalConnectionStatus,
  OperationalSourcePort,
} from "./contracts/operational-source-port.js";

export {
  DepartmentCapabilityRegistry,
  deriveCapabilityState,
  type DerivedCapabilityState,
  type RegistryOptions,
  type RegistrySort,
} from "./registry/department-capability-registry.js";

export {
  resolveCapability,
  type AcquisitionRequest,
  type CapabilityResolution,
  type CapabilityResolutionInput,
  type ResolvedCapability,
} from "./resolver/capability-resolver.js";

export {
  SKILL_CREATOR_ORDER,
  SKILL_PIPELINE_ORDER,
  canRegister,
  canRegisterGeneratedCapability,
  generatedCapabilityBlockReason,
  nextStage,
  registrationBlockReason,
  skillCreatorStageReached,
  skillPipelineStageReached,
  type SkillCreatorArtifact,
  type SkillCreatorLifecycle,
  type SkillCreatorRequest,
  type SkillCreatorStage,
  type SkillFinderPipeline,
  type SkillImportResult,
  type SkillInspection,
  type SkillPipelineProgress,
  type SkillPipelineStage,
  type SkillProvenance,
  type SkillSpecification,
  type SkillValidationResult,
} from "./skills/index.js";

export {
  buildOperationalContext,
  type OperationalContext,
  type OperationalContextApproval,
  type OperationalContextCapability,
  type OperationalContextCompany,
  type OperationalContextDepartment,
  type OperationalContextInput,
  type OperationalContextMemory,
  type OperationalContextSystem,
  type OperationalContextTask,
} from "./context/operational-context.js";

export {
  InMemoryCapabilityEventPublisher,
  NoopCapabilityEventPublisher,
  type CapabilityEvent,
  type CapabilityEventKind,
  type CapabilityEventPublisher,
} from "./events/capability-events.js";

export {
  MAUTIC_CAPABILITY_ID,
  MAUTIC_DEPARTMENT,
  buildMauticCapability,
  certifyMauticCapability,
} from "./capabilities/mautic-capability.js";

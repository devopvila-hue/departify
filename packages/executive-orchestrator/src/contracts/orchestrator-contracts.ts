/**
 * Orchestrator Intent — the three deterministic intents Sprint 23 enables.
 *
 * These intents are NOT Executive Intents. They are orchestrator-level
 * intents that the ExecutiveOrchestrator adapts into an existing Executive
 * Intent (`assign_task`) before invoking Executive Director. This keeps
 * Executive Director's contracts untouched.
 */
export const orchestratorIntentTypes = [
  "health_check",
  "organization_summary",
  "generate_identifier",
] as const;

export type OrchestratorIntentType = (typeof orchestratorIntentTypes)[number];

export interface OrchestratorIntentBase<TType extends OrchestratorIntentType> {
  readonly type: TType;
  readonly intentId: string;
  readonly requestedBy: string;
  readonly organizationId?: string;
  readonly agentId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export type HealthCheckIntent = OrchestratorIntentBase<"health_check">;

export interface OrganizationSummaryIntent extends OrchestratorIntentBase<"organization_summary"> {
  readonly organizationId: string;
}

export type GenerateIdentifierIntent =
  OrchestratorIntentBase<"generate_identifier">;

export type OrchestratorIntent =
  HealthCheckIntent | OrganizationSummaryIntent | GenerateIdentifierIntent;

export type OrchestratorIntentSummary =
  HealthCheckIntent | OrganizationSummaryIntent | GenerateIdentifierIntent;

/**
 * Mapping from OrchestratorIntent to the underlying Tool it triggers. The
 * mapping is exhaustive for the three intents Sprint 23 ships.
 */
export interface OrchestratorToolMapping {
  readonly toolId: string;
  readonly toolArgs: Readonly<Record<string, unknown>>;
}

export const orchestratorToolMappings: Readonly<
  Record<OrchestratorIntentType, OrchestratorToolMapping>
> = {
  health_check: {
    toolId: "system.health",
    toolArgs: {},
  },
  organization_summary: {
    toolId: "organization.get",
    toolArgs: {},
  },
  generate_identifier: {
    toolId: "system.uuid",
    toolArgs: {},
  },
};

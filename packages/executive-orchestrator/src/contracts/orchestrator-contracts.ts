/**
 * Orchestrator Intent — the deterministic intents the orchestrator enables.
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
  "discovery_analyze",
] as const;

export type OrchestratorIntentType = (typeof orchestratorIntentTypes)[number];

export interface OrchestratorIntentBase<TType extends OrchestratorIntentType> {
  readonly type: TType;
  readonly intentId: string;
  readonly requestedBy: string;
  readonly organizationId?: string;
  readonly agentId?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  /**
   * Dynamic arguments forwarded to the underlying Tool. Optional and
   * retro-compatible: intents without toolArgs keep the static mapping args.
   * `discovery_analyze` (Sprint 30) uses this slot to carry the CompanyDNA
   * (and optional FounderBrain / question options) to `discovery.analyze`.
   */
  readonly toolArgs?: Readonly<Record<string, unknown>>;
}

export type HealthCheckIntent = OrchestratorIntentBase<"health_check">;

export interface OrganizationSummaryIntent extends OrchestratorIntentBase<"organization_summary"> {
  readonly organizationId: string;
}

export type GenerateIdentifierIntent =
  OrchestratorIntentBase<"generate_identifier">;

export type DiscoveryAnalyzeIntent =
  OrchestratorIntentBase<"discovery_analyze">;

export type OrchestratorIntent =
  | HealthCheckIntent
  | OrganizationSummaryIntent
  | GenerateIdentifierIntent
  | DiscoveryAnalyzeIntent;

export type OrchestratorIntentSummary =
  | HealthCheckIntent
  | OrganizationSummaryIntent
  | GenerateIdentifierIntent
  | DiscoveryAnalyzeIntent;

/**
 * Mapping from OrchestratorIntent to the underlying Tool it triggers. The
 * mapping is exhaustive for the intents the orchestrator ships.
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
  discovery_analyze: {
    toolId: "discovery.analyze",
    toolArgs: {},
  },
};

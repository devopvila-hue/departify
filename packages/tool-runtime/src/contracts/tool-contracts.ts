/**
 * Domain model for the Tool Runtime.
 *
 * All identifiers are typed strings so future cross-package coordination can
 * stay provider-neutral and host-independent. The Runtime never assumes a
 * concrete database, network, or actor identity format; consumers compose
 * whatever IDs make sense for their context (organization, agent, request,
 * correlation).
 */
export type ToolId = string;
export type ToolVersion = string;

/**
 * Identifier of the agent that requested the tool execution. Reserved for
 * Executive Director / Agent Runtime integration.
 */
export type ToolAgentId = string;

/**
 * Identifier of the organization owning the execution. Reserved for future
 * organization-scoped tooling.
 */
export type ToolOrganizationId = string;

/**
 * Identifier of the request that triggered the tool execution. Useful for
 * correlating with upstream LLM Router traces, Executive Director decisions
 * or Agent Runtime plans.
 */
export type ToolRequestId = string;

/**
 * Coarse-grained permission scopes a Tool may advertise or require.
 *
 * The Runtime does not interpret the semantics of these scopes; it stores,
 * matches and forwards them. Higher-level packages (auth, agent runtime)
 * decide what each scope unlocks.
 */
export const toolScopes = [
  "read.public",
  "read.private",
  "write.public",
  "write.private",
  "execute.network",
  "execute.shell",
  "execute.filesystem",
  "execute.database",
  "execute.financial",
  "execute.compliance",
] as const;

export type ToolScope = (typeof toolScopes)[number];

/**
 * Capabilities a Tool declares. Capabilities are coarse descriptors that the
 * Runtime uses for planning, observability and authorization decisions; they
 * are not coupled to any provider SDK.
 */
export const toolCapabilities = [
  "idempotent",
  "side_effect_free",
  "deterministic",
  "long_running",
  "streaming",
  "cancellable",
  "retryable",
  "network_access",
  "filesystem_access",
  "credential_aware",
] as const;

export type ToolCapability = (typeof toolCapabilities)[number];

/**
 * Immutable metadata describing a Tool. Optional fields default to permissive
 * safe defaults when the Tool does not specify them.
 */
export interface ToolMetadata {
  readonly displayName: string;
  readonly description: string;
  readonly owner?: string;
  readonly tags?: readonly string[];
  readonly documentationUrl?: string;
}

/**
 * Static description of a Tool. The Runtime only consumes the description;
 * concrete implementation logic is supplied through the executable hook.
 */
export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  readonly id: ToolId;
  readonly version: ToolVersion;
  readonly metadata: ToolMetadata;
  readonly capabilities: readonly ToolCapability[];
  readonly requiredScopes: readonly ToolScope[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly executor?: ToolExecutor<TArgs, TResult>;
  readonly limits?: ToolLimits;
}

/**
 * Concrete execution hook attached to a definition. The Runtime never calls
 * this directly during Sprint 20 (real execution is disabled); future sprints
 * will wire this into the pipeline.
 */
export type ToolExecutor<TArgs = unknown, TResult = unknown> = (
  context: ToolExecutionContext,
  args: TArgs,
  signal: AbortSignal,
) => Promise<TResult>;

/**
 * Limits applied to a single Tool execution. The Runtime enforces the ones
 * it can synchronously (timeouts, cancellation) and forwards the rest to
 * adapters.
 */
export interface ToolLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
  readonly maxRetries?: number;
  readonly maxConcurrentInvocations?: number;
}

/**
 * Context attached to every execution. The Runtime fills identity fields
 * itself; the rest is propagated verbatim from the request.
 */
export interface ToolExecutionContext {
  readonly toolId: ToolId;
  readonly toolVersion: ToolVersion;
  readonly requestId: ToolRequestId;
  readonly organizationId?: ToolOrganizationId;
  readonly agentId?: ToolAgentId;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Caller-supplied request to execute a Tool.
 */
export interface ToolExecutionRequest<TArgs = unknown> {
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
  readonly toolVersion?: ToolVersion;
  readonly args: TArgs;
  readonly organizationId?: ToolOrganizationId;
  readonly agentId?: ToolAgentId;
  readonly requestedScopes?: readonly ToolScope[];
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Result returned by the Runtime. Successful, failed and cancelled executions
 * share the same envelope so callers can branch on `status` alone.
 */
export type ToolExecutionStatus = "completed" | "failed" | "cancelled";

export interface ToolExecutionResult<TResult = unknown> {
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
  readonly toolVersion: ToolVersion;
  readonly status: ToolExecutionStatus;
  readonly output?: TResult;
  readonly error?: ToolExecutionErrorEnvelope;
  readonly durationMs: number;
  readonly startedAt: string;
  readonly completedAt: string;
}

/**
 * Error envelope preserved across pipeline phases. The Runtime keeps the
 * original error class for diagnostics while exposing a code for routing.
 */
export interface ToolExecutionErrorEnvelope {
  readonly code: string;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * Lightweight Tool abstraction required by the registry contract. A Tool is
 * the pair of an immutable `ToolDefinition` plus a runtime lifecycle. The
 * Runtime ships the lifecycle helpers; concrete tools supply the executor
 * through the definition.
 */
export interface Tool {
  readonly definition: ToolDefinition;
  readonly status: ToolLifecycleStatus;
  readonly registeredAt: string;
}

export type ToolLifecycleStatus =
  "registered" | "active" | "suspended" | "retired";

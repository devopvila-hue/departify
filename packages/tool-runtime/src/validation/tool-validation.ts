import {
  ToolDuplicateError,
  ToolRuntimeError,
  ToolUnknownError,
  ToolValidationError,
} from "../errors/tool-runtime-errors.js";
import {
  toolCapabilities,
  toolScopes,
  type ToolCapability,
  type ToolDefinition,
  type ToolExecutionRequest,
  type ToolExecutor,
  type ToolId,
  type ToolLifecycleStatus,
  type ToolMetadata,
  type ToolScope,
  type ToolVersion,
} from "../contracts/tool-contracts.js";

/**
 * Pure validation helpers for the Tool Runtime domain. The Runtime uses these
 * before mutating any internal state, so failures are deterministic and
 * side-effect-free.
 */

const VALID_STATUSES: readonly ToolLifecycleStatus[] = [
  "registered",
  "active",
  "suspended",
  "retired",
];

export function validateToolDefinition(definition: unknown): ToolDefinition {
  assertIsObject(definition, "Tool definition must be an object.");
  const candidate = definition as Record<string, unknown>;

  const id = assertNonEmptyString(candidate.id, "Tool id");
  const version = assertNonEmptyString(candidate.version, "Tool version");
  const metadata = validateMetadata(candidate.metadata);
  const capabilities = validateCapabilities(candidate.capabilities);
  const requiredScopes = validateScopes(candidate.requiredScopes);
  const inputSchema = validateSchema(
    candidate.inputSchema,
    "inputSchema",
    /*allowEmpty*/ false,
  );
  const outputSchema = validateSchema(
    candidate.outputSchema,
    "outputSchema",
    /*allowEmpty*/ true,
  );
  const limits = validateOptionalLimits(candidate.limits);
  const executor = validateOptionalExecutor(candidate.executor);

  const baseDefinition = {
    id,
    version,
    metadata,
    capabilities,
    requiredScopes,
    inputSchema,
    outputSchema,
    ...(executor ? { executor } : {}),
    ...(limits ? { limits } : {}),
  };
  return Object.freeze(baseDefinition) as ToolDefinition;
}

export function validateToolRequest<TArgs>(
  request: unknown,
): ToolExecutionRequest<TArgs> {
  assertIsObject(request, "Tool execution request must be an object.");
  const candidate = request as Record<string, unknown>;

  const requestId = assertNonEmptyString(candidate.requestId, "requestId");
  const toolId = assertNonEmptyString(candidate.toolId, "toolId");
  const args = candidate.args;
  assertIsObject(args, "args must be an object.");

  const toolVersion =
    typeof candidate.toolVersion === "string" &&
    candidate.toolVersion.length > 0
      ? candidate.toolVersion
      : undefined;
  const organizationId =
    typeof candidate.organizationId === "string" &&
    candidate.organizationId.length > 0
      ? candidate.organizationId
      : undefined;
  const agentId =
    typeof candidate.agentId === "string" && candidate.agentId.length > 0
      ? candidate.agentId
      : undefined;
  const metadata =
    typeof candidate.metadata === "object" && candidate.metadata !== null
      ? (candidate.metadata as Record<string, string>)
      : undefined;
  const requestedScopes = validateOptionalScopes(candidate.requestedScopes);

  return {
    requestId,
    toolId,
    ...(toolVersion ? { toolVersion } : {}),
    args: args as TArgs,
    ...(organizationId ? { organizationId } : {}),
    ...(agentId ? { agentId } : {}),
    ...(metadata ? { metadata } : {}),
    ...(requestedScopes ? { requestedScopes } : {}),
  };
}

function validateOptionalExecutor(value: unknown): ToolExecutor | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new ToolValidationError("Tool executor must be a function.");
  }
  return value as ToolExecutor;
}

export function validateToolId(id: string): ToolId {
  return assertNonEmptyString(id, "Tool id");
}

export function validateToolVersion(version: string): ToolVersion {
  return assertNonEmptyString(version, "Tool version");
}

export function validateLifecycleStatus(status: unknown): ToolLifecycleStatus {
  if (typeof status !== "string") {
    throw new ToolValidationError("Lifecycle status must be a string.");
  }
  if (!VALID_STATUSES.includes(status as ToolLifecycleStatus)) {
    throw new ToolValidationError(
      `Lifecycle status '${status}' is not recognised.`,
    );
  }
  return status as ToolLifecycleStatus;
}

function validateMetadata(metadata: unknown): ToolMetadata {
  assertIsObject(metadata, "Tool metadata is required.");
  const candidate = metadata as Record<string, unknown>;
  const displayName = assertNonEmptyString(
    candidate.displayName,
    "metadata.displayName",
  );
  const description = assertNonEmptyString(
    candidate.description,
    "metadata.description",
  );
  const owner =
    typeof candidate.owner === "string" && candidate.owner.length > 0
      ? candidate.owner
      : undefined;
  const tags = Array.isArray(candidate.tags)
    ? (candidate.tags.filter((tag) => typeof tag === "string") as string[])
    : undefined;
  const documentationUrl =
    typeof candidate.documentationUrl === "string" &&
    candidate.documentationUrl.length > 0
      ? candidate.documentationUrl
      : undefined;

  return {
    displayName,
    description,
    ...(owner ? { owner } : {}),
    ...(tags ? { tags } : {}),
    ...(documentationUrl ? { documentationUrl } : {}),
  };
}

function validateCapabilities(value: unknown): readonly ToolCapability[] {
  if (!Array.isArray(value)) {
    throw new ToolValidationError("Tool capabilities must be an array.");
  }
  const result: ToolCapability[] = [];
  for (const capability of value) {
    if (typeof capability !== "string") {
      throw new ToolValidationError("Tool capability must be a string.");
    }
    if (!toolCapabilities.includes(capability as ToolCapability)) {
      throw new ToolValidationError(
        `Tool capability '${capability}' is not recognised.`,
      );
    }
    result.push(capability as ToolCapability);
  }
  if (new Set(result).size !== result.length) {
    throw new ToolValidationError(
      "Tool capabilities must not contain duplicates.",
    );
  }
  if (result.length === 0) {
    throw new ToolValidationError("Tool must declare at least one capability.");
  }
  return result;
}

function validateScopes(value: unknown): readonly ToolScope[] {
  if (!Array.isArray(value)) {
    throw new ToolValidationError("Tool requiredScopes must be an array.");
  }
  const result: ToolScope[] = [];
  for (const scope of value) {
    if (typeof scope !== "string") {
      throw new ToolValidationError("Tool scope must be a string.");
    }
    if (!toolScopes.includes(scope as ToolScope)) {
      throw new ToolValidationError(`Tool scope '${scope}' is not recognised.`);
    }
    result.push(scope as ToolScope);
  }
  return Array.from(new Set(result));
}

function validateOptionalScopes(
  value: unknown,
): readonly ToolScope[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return validateScopes(value);
}

function validateSchema(
  value: unknown,
  field: string,
  allowEmpty: boolean,
): Readonly<Record<string, unknown>> {
  if (value === undefined || value === null) {
    if (allowEmpty) {
      return {};
    }
    throw new ToolValidationError(`Tool ${field} is required.`);
  }
  if (typeof value !== "object") {
    throw new ToolValidationError(`Tool ${field} must be an object.`);
  }
  const object = value as Record<string, unknown>;
  if (!allowEmpty && Object.keys(object).length === 0) {
    throw new ToolValidationError(`Tool ${field} cannot be empty.`);
  }
  return Object.freeze({ ...object });
}

function validateOptionalLimits(
  value: unknown,
): ToolDefinition["limits"] | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertIsObject(value, "Tool limits must be an object.");
  const candidate = value as Record<string, unknown>;
  const timeoutMs = assertIntegerInRange(
    candidate.timeoutMs,
    "limits.timeoutMs",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const maxOutputBytes =
    candidate.maxOutputBytes === undefined
      ? undefined
      : assertIntegerInRange(
          candidate.maxOutputBytes,
          "limits.maxOutputBytes",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  const maxRetries =
    candidate.maxRetries === undefined
      ? undefined
      : assertIntegerInRange(
          candidate.maxRetries,
          "limits.maxRetries",
          0,
          Number.MAX_SAFE_INTEGER,
        );
  const maxConcurrentInvocations =
    candidate.maxConcurrentInvocations === undefined
      ? undefined
      : assertIntegerInRange(
          candidate.maxConcurrentInvocations,
          "limits.maxConcurrentInvocations",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  return {
    timeoutMs,
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(maxConcurrentInvocations !== undefined
      ? { maxConcurrentInvocations }
      : {}),
  };
}

function assertIsObject(
  value: unknown,
  message: string,
): asserts value is object {
  if (value === null || typeof value !== "object") {
    throw new ToolValidationError(message);
  }
}

function assertNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolValidationError(`Tool ${field} is required.`);
  }
  return value.trim();
}

function assertIntegerInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ToolValidationError(`Tool ${field} must be an integer.`);
  }
  if (value < min || value > max) {
    throw new ToolValidationError(
      `Tool ${field} must be between ${min} and ${max}.`,
    );
  }
  return value;
}

/**
 * Re-raises any non-runtime error as a `ToolRuntimeError` so callers can rely
 * on the runtime error taxonomy. Pure helper; no I/O. The original message
 * is preserved so diagnostic output stays meaningful.
 */
export function asRuntimeError(cause: unknown): ToolRuntimeError {
  if (cause instanceof ToolRuntimeError) {
    return cause;
  }
  if (cause instanceof Error) {
    return new ToolRuntimeError(cause.message, "execution_failed", {
      cause,
    });
  }
  return new ToolRuntimeError("Unknown error.", "execution_failed", {
    cause,
  });
}

export { ToolDuplicateError, ToolUnknownError };

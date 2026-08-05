import type {
  AgentId,
  AgentPermission,
  AgentPermissionSet,
} from "@departify/agent-runtime";
import {
  type ToolExecutionRequest,
  type ToolExecutionResult,
  type ToolRuntime,
  type ToolScope,
  type ToolAuthorizationPolicy,
} from "@departify/tool-runtime";

import {
  type AgentToolAction,
  type AgentToolActionResult,
  type AgentToolOutcome,
  type AgentToolPort,
} from "../contracts/agent-tool-port.js";

/**
 * Mapping from Agent permissions to Tool scopes. The bridge uses a small
 * static table so Sprint 21 can demonstrate the integration end-to-end
 * without coupling to `packages/auth`. Future sprints may source this table
 * from a configurable adapter.
 */
export interface AgentPermissionToScopeResolver {
  resolve(
    permissionSet: AgentPermissionSet,
    toolId: string,
  ): readonly ToolScope[];
}

const DEFAULT_SCOPE_BY_ACTION: Readonly<Record<string, ToolScope[]>> = {
  read: ["read.public"],
  write: ["write.public"],
  execute: ["read.public", "execute.network"],
  manage: ["read.public", "write.private", "execute.network"],
};

export class DefaultAgentPermissionScopeResolver implements AgentPermissionToScopeResolver {
  resolve(
    permissionSet: AgentPermissionSet,
    toolId: string,
  ): readonly ToolScope[] {
    const scopes = new Set<ToolScope>();
    for (const permission of permissionSet.permissions) {
      if (
        permission.resource === "*" ||
        permission.resource === toolId ||
        permission.resource.startsWith(`${toolId}:`)
      ) {
        const granted = DEFAULT_SCOPE_BY_ACTION[permission.action];
        if (granted) {
          for (const scope of granted) {
            scopes.add(scope);
          }
        }
      }
    }
    return [...scopes];
  }
}

/**
 * Authorization policy used by the adapter. The adapter derives the scopes
 * the caller needs from its permission set, then forwards them to the
 * Tool Runtime alongside the Tool definition.
 */
export class AgentScopedAuthorizationPolicy implements ToolAuthorizationPolicy {
  authorize(input: {
    definition: { requiredScopes: readonly ToolScope[] };
    request: ToolExecutionRequest;
    grantedScopes: readonly ToolScope[];
  }): { allowed: true } | { allowed: false; reason: string } {
    const required = new Set(input.definition.requiredScopes);
    const granted = new Set(input.grantedScopes);
    const missing = [...required].filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `Agent is missing required scopes: ${missing.join(", ")}.`,
      };
    }
    return { allowed: true };
  }
}

export interface AgentToolRuntimeAdapterOptions {
  readonly runtime: ToolRuntime;
  readonly fetchPermissionSet: (agentId: AgentId) => AgentPermissionSet | null;
  readonly scopeResolver?: AgentPermissionToScopeResolver;
  readonly authorization?: ToolAuthorizationPolicy;
}

/**
 * Official adapter implementing `AgentToolPort` on top of `ToolRuntime`.
 *
 * The adapter never inspects or mutates the Tool's args. It only translates
 * identity fields (agentId, organizationId, metadata) and translates the
 * outcome into the Port's envelope. Tool Runtime keeps its own contract.
 */
export class AgentToolRuntimeAdapter implements AgentToolPort {
  private readonly runtime: ToolRuntime;
  private readonly fetchPermissionSet: (
    agentId: AgentId,
  ) => AgentPermissionSet | null;
  private readonly scopeResolver: AgentPermissionToScopeResolver;
  private readonly authorization: ToolAuthorizationPolicy;

  constructor(options: AgentToolRuntimeAdapterOptions) {
    this.runtime = options.runtime;
    this.fetchPermissionSet = options.fetchPermissionSet;
    this.scopeResolver =
      options.scopeResolver ?? new DefaultAgentPermissionScopeResolver();
    this.authorization =
      options.authorization ?? new AgentScopedAuthorizationPolicy();
  }

  async executeAction<TResult = unknown>(
    action: AgentToolAction<TResult>,
  ): Promise<AgentToolOutcome> {
    const permissionSet = this.fetchPermissionSet(action.agentId);
    if (!permissionSet) {
      return {
        actionId: action.actionId,
        agentId: action.agentId,
        toolId: action.toolId,
        status: "rejected",
        reason: `Agent '${action.agentId}' is not registered with the bridge.`,
        code: "agent_not_registered",
        occurredAt: new Date().toISOString(),
      };
    }

    const grantedScopes = this.scopeResolver.resolve(
      permissionSet,
      action.toolId,
    );

    const definition = (() => {
      try {
        return action.toolVersion
          ? this.runtime.registry.get(action.toolId, action.toolVersion)
              .definition
          : this.runtime.registry.get(action.toolId).definition;
      } catch {
        return null;
      }
    })();

    if (!definition) {
      return {
        actionId: action.actionId,
        agentId: action.agentId,
        toolId: action.toolId,
        status: "rejected",
        reason: `Tool '${action.toolId}' is not registered with the Tool Runtime.`,
        code: "tool_not_registered",
        occurredAt: new Date().toISOString(),
      };
    }

    const decision = this.authorization.authorize({
      definition,
      request: this.buildRequest(action),
      grantedScopes,
    });

    if (!decision.allowed) {
      return {
        actionId: action.actionId,
        agentId: action.agentId,
        toolId: action.toolId,
        status: "rejected",
        reason: decision.reason,
        code: "authorization_failed",
        occurredAt: new Date().toISOString(),
      };
    }

    const result = await this.runtime.execute(this.buildRequest(action));
    return this.toPortEnvelope(result, action);
  }

  /**
   * Builds the `ToolExecutionRequest` envelope consumed by the Tool Runtime.
   * Pure mapping: no validation, no defaults, no I/O.
   */
  private buildRequest<TResult>(
    action: AgentToolAction<TResult>,
  ): ToolExecutionRequest {
    const args = action.args as Readonly<Record<string, unknown>>;
    return {
      requestId: action.actionId,
      toolId: action.toolId,
      ...(action.toolVersion ? { toolVersion: action.toolVersion } : {}),
      args,
      agentId: action.agentId,
      ...(action.organizationId
        ? { organizationId: action.organizationId }
        : {}),
      ...(action.metadata ? { metadata: action.metadata } : {}),
    };
  }

  /**
   * Translates the Tool Runtime envelope into the Port envelope by adding
   * the `actionId` correlation field. Successful, failed and cancelled
   * outcomes share the same shape.
   */
  private toPortEnvelope<TResult>(
    result: ToolExecutionResult<TResult>,
    action: AgentToolAction<TResult>,
  ): AgentToolActionResult<TResult> {
    const envelope: AgentToolActionResult<TResult> = {
      ...result,
      actionId: action.actionId,
    };
    return Object.freeze(envelope) as AgentToolActionResult<TResult>;
  }
}

/**
 * Convenience factory that wires the default policy + scope resolver into
 * the adapter.
 */
export function createAgentToolRuntimeAdapter(
  options: AgentToolRuntimeAdapterOptions,
): AgentToolRuntimeAdapter {
  return new AgentToolRuntimeAdapter(options);
}

/**
 * Helper that captures the typical wiring: the host supplies a permission
 * set lookup that returns `null` for unknown agents. Tests can use a `Map`
 * keyed by agentId.
 */
export function buildAgentPermissionSetResolver(
  registry: ReadonlyMap<AgentId, readonly AgentPermission[]>,
): (agentId: AgentId) => AgentPermissionSet | null {
  return (agentId: AgentId): AgentPermissionSet | null => {
    const permissions = registry.get(agentId);
    if (!permissions) {
      return null;
    }
    return { permissions };
  };
}

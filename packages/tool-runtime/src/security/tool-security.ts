import type {
  ToolCapability,
  ToolDefinition,
  ToolLimits,
  ToolScope,
} from "../contracts/tool-contracts.js";
import { ToolAuthorizationError } from "../errors/tool-runtime-errors.js";

/**
 * Security primitives for the Tool Runtime.
 *
 * Sprint 20 ships the *contract* only. Concrete enforcement (process
 * isolation, OS sandboxes, capability dropping) is the responsibility of
 * future adapters that may plug a real sandbox behind these interfaces.
 */

export type IsolationLevel =
  "logical" | "process" | "container" | "vm" | "remote";

export interface IsolationPolicy {
  /**
   * Minimum isolation level required to execute the supplied Tool. The
   * Runtime rejects any Tool whose required isolation exceeds the active
   * runtime isolation.
   */
  minimumIsolationFor(tool: ToolDefinition): IsolationLevel;
}

export interface CancellationPolicy {
  /**
   * Indicates whether the supplied Tool supports cooperative cancellation.
   * Tools that opt out of cancellation cannot be cancelled by the Runtime.
   */
  isCancellable(tool: ToolDefinition): boolean;
}

export interface LimitPolicy {
  /**
   * Effective limits applied to an execution. Returns a merged view of the
   * caller-supplied overrides and the Tool defaults. The result is always a
   * fully populated `ToolLimits` instance.
   */
  effectiveLimits(
    tool: ToolDefinition,
    overrides?: Partial<ToolLimits>,
  ): ToolLimits;
}

/**
 * Default security implementation: Tools that declare `network_access` or
 * `filesystem_access` capabilities require at least `process` isolation.
 * Tools without those capabilities can run at `logical` isolation.
 */
export class DefaultIsolationPolicy implements IsolationPolicy {
  minimumIsolationFor(tool: ToolDefinition): IsolationLevel {
    const capabilities = new Set<ToolCapability>(tool.capabilities);
    if (
      capabilities.has("network_access") ||
      capabilities.has("filesystem_access")
    ) {
      return "process";
    }
    return "logical";
  }
}

export class DefaultCancellationPolicy implements CancellationPolicy {
  isCancellable(tool: ToolDefinition): boolean {
    const capabilities = new Set<ToolCapability>(tool.capabilities);
    return capabilities.has("cancellable") || capabilities.has("long_running");
  }
}

export class DefaultLimitPolicy implements LimitPolicy {
  private static readonly DEFAULT_TIMEOUT_MS = 5_000;
  private static readonly DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
  private static readonly DEFAULT_MAX_RETRIES = 0;

  effectiveLimits(
    tool: ToolDefinition,
    overrides?: Partial<ToolLimits>,
  ): ToolLimits {
    return {
      timeoutMs:
        overrides?.timeoutMs ??
        tool.limits?.timeoutMs ??
        DefaultLimitPolicy.DEFAULT_TIMEOUT_MS,
      maxOutputBytes:
        overrides?.maxOutputBytes ??
        tool.limits?.maxOutputBytes ??
        DefaultLimitPolicy.DEFAULT_MAX_OUTPUT_BYTES,
      maxRetries:
        overrides?.maxRetries ??
        tool.limits?.maxRetries ??
        DefaultLimitPolicy.DEFAULT_MAX_RETRIES,
    };
  }
}

/**
 * Validates that a Tool's requested scopes are a subset of what the active
 * isolation level permits. Sprint 20 ships a permissive policy: any
 * declared scope is allowed; future sprints will wire this into real
 * isolation primitives.
 */
export function assertScopeCompatibility(
  scopes: readonly ToolScope[],
  isolation: IsolationLevel,
): void {
  if (scopes.length === 0) {
    return;
  }
  if (isolation === "logical") {
    const restricted: ToolScope[] = [
      "execute.shell",
      "execute.network",
      "execute.filesystem",
      "execute.database",
      "execute.financial",
    ];
    const conflicts = scopes.filter((scope) => restricted.includes(scope));
    if (conflicts.length > 0) {
      throw new ToolAuthorizationError(
        `Isolation level 'logical' cannot satisfy scopes: ${conflicts.join(", ")}.`,
      );
    }
  }
}

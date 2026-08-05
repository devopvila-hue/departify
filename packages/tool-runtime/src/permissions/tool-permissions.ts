import type {
  ToolDefinition,
  ToolExecutionRequest,
  ToolScope,
} from "../contracts/tool-contracts.js";
import { ToolAuthorizationError } from "../errors/tool-runtime-errors.js";

/**
 * Permissions and authorization policy contract for the Tool Runtime.
 *
 * The Runtime never calls into auth or identity systems. It receives a
 * `ToolAuthorizationPolicy` at composition time and forwards it the data
 * required to make a decision. Policies are pure functions; they may not
 * mutate state or perform I/O.
 */

export interface ToolAuthorizationPolicy {
  authorize(input: ToolAuthorizationInput): ToolAuthorizationDecision;
}

export interface ToolAuthorizationInput {
  readonly definition: ToolDefinition;
  readonly request: ToolExecutionRequest;
  readonly grantedScopes: readonly ToolScope[];
}

export type ToolAuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Default authorization policy: the caller must have been granted every
 * scope listed in the Tool definition. Requests asking for additional
 * scopes are rejected unless they are already granted.
 */
export class ScopeBasedAuthorizationPolicy implements ToolAuthorizationPolicy {
  authorize(input: ToolAuthorizationInput): ToolAuthorizationDecision {
    const required = new Set(input.definition.requiredScopes);
    const granted = new Set(input.grantedScopes);
    const missing = [...required].filter((scope) => !granted.has(scope));
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `Caller is missing required scopes: ${missing.join(", ")}.`,
      };
    }
    const requested = input.request.requestedScopes ?? [];
    const overflow = requested.filter((scope) => !granted.has(scope));
    if (overflow.length > 0) {
      return {
        allowed: false,
        reason: `Caller requested ungranted scopes: ${overflow.join(", ")}.`,
      };
    }
    return { allowed: true };
  }
}

/**
 * Authorization decision evaluator used by the pipeline. Policies raise
 * `ToolAuthorizationError` instead of returning a denied decision so the
 * pipeline never silently swallows denials.
 */
export function evaluateAuthorization(
  policy: ToolAuthorizationPolicy,
  input: ToolAuthorizationInput,
): void {
  const decision = policy.authorize(input);
  if (!decision.allowed) {
    throw new ToolAuthorizationError(decision.reason);
  }
}

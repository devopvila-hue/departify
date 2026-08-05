import type { AgentId, AgentOrganizationId } from "@departify/agent-runtime";
import type { ToolExecutionResult } from "@departify/tool-runtime";

/**
 * Agent Tool Port — the only contract Agent Runtime is allowed to use to
 * execute Tools. The bridge implements it; the runtime consumes it.
 *
 * The Port is intentionally minimal: it accepts an action description and
 * returns the same envelope the Tool Runtime produces. Neither runtime
 * imports the other directly; both speak through this interface.
 */

/**
 * Description of a single Tool invocation produced by the Agent Runtime.
 *
 * `actionId` correlates the call back to the agent's plan; `toolId` and
 * optional `toolVersion` identify the Tool registered in the Tool Runtime.
 * `args` is forwarded verbatim — the bridge never inspects or mutates it.
 */
export interface AgentToolAction<TResult = unknown> {
  readonly actionId: string;
  readonly agentId: AgentId;
  readonly organizationId?: AgentOrganizationId;
  readonly toolId: string;
  readonly toolVersion?: string;
  readonly args: TResult;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Result envelope returned to Agent Runtime. It mirrors the Tool Runtime
 * envelope plus an `actionId` field so callers can correlate the response
 * with the originating action.
 */
export type AgentToolActionResult<TResult = unknown> =
  ToolExecutionResult<TResult> & {
    readonly actionId: string;
  };

/**
 * Outcome reported by the Port to its caller. The Port always resolves; it
 * never throws. Errors are surfaced as typed `AgentToolOutcomeError`s
 * derived from the Tool Runtime envelope so callers can branch on a stable
 * shape.
 */
export type AgentToolOutcome = AgentToolActionResult | AgentToolOutcomeError;

export interface AgentToolOutcomeError {
  readonly actionId: string;
  readonly agentId: AgentId;
  readonly toolId: string;
  readonly status: "rejected";
  readonly reason: string;
  readonly code: string;
  readonly occurredAt: string;
}

export interface AgentToolPort {
  executeAction(action: AgentToolAction): Promise<AgentToolOutcome>;
  executeAction<TResult>(
    action: AgentToolAction<TResult>,
  ): Promise<AgentToolOutcome>;
}

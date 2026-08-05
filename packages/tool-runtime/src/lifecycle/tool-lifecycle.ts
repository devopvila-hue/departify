import type { Tool, ToolLifecycleStatus } from "../contracts/tool-contracts.js";
import { ToolRuntimeError } from "../errors/tool-runtime-errors.js";

/**
 * Pure Tool lifecycle helpers. The Registry owns the actual transitions; the
 * helpers here centralise the rules that govern legal transitions so both
 * the Registry and the pipeline share the same definition.
 *
 * Lifecycle graph:
 *   registered → active | suspended | retired
 *   active     → suspended | retired
 *   suspended  → active | retired
 *   retired    is terminal
 */

const ALLOWED: Readonly<
  Record<ToolLifecycleStatus, readonly ToolLifecycleStatus[]>
> = {
  registered: ["active", "suspended", "retired"],
  active: ["suspended", "retired"],
  suspended: ["active", "retired"],
  retired: [],
};

export function canTransition(
  from: ToolLifecycleStatus,
  to: ToolLifecycleStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(
  from: ToolLifecycleStatus,
  to: ToolLifecycleStatus,
): void {
  if (!canTransition(from, to)) {
    throw new ToolRuntimeError(
      `Illegal Tool lifecycle transition: ${from} → ${to}.`,
      "validation_failed",
    );
  }
}

/**
 * Returns the Tools whose lifecycle status permits execution. The pipeline
 * consults this filter before calling the executor.
 */
export function isExecutable(tool: Tool): boolean {
  return tool.status === "active";
}

/**
 * Returns the Tools whose lifecycle status allows them to remain registered
 * for inspection. `retired` Tools are excluded by the Registry.
 */
export function isVisible(tool: Tool): boolean {
  return tool.status !== "retired";
}

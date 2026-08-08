/**
 * Capability Contract — Sprint 62.
 *
 * The ONE canonical representation of a department capability. A capability
 * is the abstraction the CEO sees and the Department Head reasons with:
 * "what can Marketing currently do?".
 *
 * It intentionally reuses the repository's existing primitives:
 *   - `requiredConnections` reference ConnectionState toolIds (operational truth).
 *   - `actions[].toolId` reference Tool Runtime tool ids (the execution boundary).
 *   - `requiredCredentials` hold credential variable NAMES, never values.
 *   - scopes/risk reuse the spirit of Tool Runtime scopes without importing a
 *     second execution model.
 *
 * This module is provider-independent and pure: it reads no environment, makes
 * no HTTP calls, and never imports a runtime. Operational derivation (READY /
 * unavailable) is computed by the DepartmentCapabilityRegistry from an
 * OperationalSourcePort supplied by the host.
 */

export type CapabilitySource =
  | "native"
  | "integration"
  | "mcp"
  | "imported"
  | "generated"
  | "workflow";

export type CapabilityStatus =
  | "discovered"
  | "installing"
  | "validating"
  | "ready"
  | "degraded"
  | "unavailable";

export type CapabilityHealth = "operational" | "degraded" | "down";

/** Risk classification driving the approval policy. */
export type CapabilityRiskLevel =
  | "read"
  | "analysis"
  | "internal_action"
  | "consequential";

/**
 * Approval policy. Read/analysis/internal actions may run automatically under
 * the existing policies; consequential actions require the existing CEO
 * approval system.
 */
export type CapabilityApprovalPolicy = "auto" | "requires_approval";

export type CapabilityActionKind = "read" | "write";

export interface CapabilityAction {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Backing Tool Runtime tool id (execution boundary), when applicable. */
  readonly toolId?: string;
  readonly kind: CapabilityActionKind;
  readonly riskLevel: CapabilityRiskLevel;
  readonly approvalPolicy: CapabilityApprovalPolicy;
}

/** Deterministic verification evidence. READY requires this to be passed. */
export interface CapabilityVerification {
  readonly status: "none" | "pending" | "passed" | "failed";
  /** Human/machine readable checks that were run. */
  readonly checks: readonly string[];
  readonly verifiedAt?: string;
}

export interface CapabilityContract {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Department that owns this capability (e.g. "marketing"). */
  readonly department: string;
  /** Provider/system that supplies it (e.g. "mautic"). */
  readonly provider: string;
  readonly version: string;
  readonly source: CapabilitySource;
  /** Connection state is operational truth; requiredConnections gate status. */
  readonly requiredConnections: readonly string[];
  /** Credential variable NAMES only — never values. */
  readonly requiredCredentials: readonly string[];
  readonly actions: readonly CapabilityAction[];
  readonly readActions: readonly string[];
  readonly writeActions: readonly string[];
  readonly riskLevel: CapabilityRiskLevel;
  readonly approvalPolicy: CapabilityApprovalPolicy;
  readonly verification: CapabilityVerification;
}

export function createCapabilityAction(
  input: Omit<CapabilityAction, "kind" | "riskLevel" | "approvalPolicy"> & {
    kind?: CapabilityActionKind;
    riskLevel?: CapabilityRiskLevel;
    approvalPolicy?: CapabilityApprovalPolicy;
  },
): CapabilityAction {
  const kind = input.kind ?? "read";
  const riskLevel = input.riskLevel ?? "read";
  const approvalPolicy = input.approvalPolicy ?? "auto";
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    ...(input.toolId ? { toolId: input.toolId } : {}),
    kind,
    riskLevel,
    approvalPolicy,
  };
}

export function readActionsOf(
  capability: Pick<CapabilityContract, "actions">,
): readonly CapabilityAction[] {
  return capability.actions.filter((action) => action.kind === "read");
}

export function writeActionsOf(
  capability: Pick<CapabilityContract, "actions">,
): readonly CapabilityAction[] {
  return capability.actions.filter((action) => action.kind === "write");
}

/** Deterministic: is the capability safe to auto-execute under the contract? */
export function requiresApproval(
  capability: Pick<CapabilityContract, "approvalPolicy" | "riskLevel">,
): boolean {
  return (
    capability.approvalPolicy === "requires_approval" ||
    capability.riskLevel === "consequential"
  );
}

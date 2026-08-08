/**
 * Department Capability Registry — Sprint 62.
 *
 * Answers the deterministic question: "what can this department currently
 * do?" The registry stores CapabilityContracts and derives their operational
 * status EXCLUSIVELY from an OperationalSourcePort (connections + tools).
 *
 * Rules (deterministic, tested):
 *
 *   - A capability with any required connection that is `connected` and whose
 *     action toolIds are all available, AND whose verification is `passed`,
 *     is `ready` (health `operational`).
 *   - If verification is not `passed` the capability can never be `ready`;
 *     it stays `validating` (or `degraded` when tools are present but
 *     unverified).
 *   - If a required connection is `blocked` / `connecting` / missing the
 *     capability is `unavailable` (or `degraded` when only some connections
 *     are ready and the rest are missing tools).
 *   - Memory never participates here.
 *
 * The registry is provider-independent and pure.
 */

import type {
  CapabilityContract,
  CapabilityHealth,
  CapabilityStatus,
} from "../contracts/capability-contract.js";
import type { OperationalSourcePort } from "../contracts/operational-source-port.js";

export interface DerivedCapabilityState {
  readonly capability: CapabilityContract;
  readonly status: CapabilityStatus;
  readonly health: CapabilityHealth;
  /** Why the state was derived — a short, stable reason. */
  readonly reason: string;
}

export type RegistrySort =
  | "id"
  | "source"
  | "status"
  | "department";

export interface RegistryOptions {
  readonly sortBy?: RegistrySort;
}

export function deriveCapabilityState(
  capability: CapabilityContract,
  source: OperationalSourcePort,
): DerivedCapabilityState {
  const required = capability.requiredConnections;
  const actionToolIds = capability.actions
    .map((action) => action.toolId)
    .filter((toolId): toolId is string => Boolean(toolId));

  const connections = required.map((toolId) => ({
    toolId,
    state: source.connection(toolId),
  }));

  const allConnected = connections.every(
    ({ state }) => state?.status === "connected",
  );
  const anyBlocked = connections.some(
    ({ state }) => state?.status === "blocked",
  );
  const anyConnecting = connections.some(
    ({ state }) => state?.status === "connecting",
  );
  const anyMissing = connections.some(({ state }) => state === null);

  const missingTools = actionToolIds.filter(
    (toolId) => !source.isToolAvailable(toolId),
  );
  const allToolsAvailable = missingTools.length === 0;

  const verified = capability.verification.status === "passed";

  // 1. Truly operational.
  if (allConnected && allToolsAvailable && verified) {
    return {
      capability,
      status: "ready",
      health: "operational",
      reason: "connected",
    };
  }

  // 2. Connected but not verified — must never be presented as READY.
  if (allConnected && allToolsAvailable && !verified) {
    return {
      capability,
      status: "validating",
      health: "degraded",
      reason: "unverified",
    };
  }

  // 3. Connected, verified, but some backing tool is missing.
  if (allConnected && !allToolsAvailable) {
    return {
      capability,
      status: "degraded",
      health: "degraded",
      reason: `missing_tools:${missingTools.join(",")}`,
    };
  }

  // 4. Blocked / connecting / missing connection.
  if (anyBlocked) {
    return {
      capability,
      status: "unavailable",
      health: "down",
      reason: "connection_blocked",
    };
  }
  if (anyConnecting) {
    return {
      capability,
      status: "installing",
      health: "degraded",
      reason: "connection_connecting",
    };
  }
  if (anyMissing) {
    return {
      capability,
      status: "unavailable",
      health: "down",
      reason: "connection_missing",
    };
  }

  return {
    capability,
    status: "unavailable",
    health: "down",
    reason: "not_connected",
  };
}

export class DepartmentCapabilityRegistry {
  private readonly capabilities = new Map<string, CapabilityContract>();

  register(capability: CapabilityContract): void {
    this.capabilities.set(capability.id, capability);
  }

  unregister(id: string): boolean {
    return this.capabilities.delete(id);
  }

  has(id: string): boolean {
    return this.capabilities.has(id);
  }

  get(id: string): CapabilityContract | null {
    return this.capabilities.get(id) ?? null;
  }

  list(): readonly CapabilityContract[] {
    return [...this.capabilities.values()];
  }

  listForDepartment(department: string): readonly CapabilityContract[] {
    return this.list().filter(
      (capability) => capability.department === department,
    );
  }

  derive(
    source: OperationalSourcePort,
    options: RegistryOptions = {},
  ): readonly DerivedCapabilityState[] {
    const states = this.list().map((capability) =>
      deriveCapabilityState(capability, source),
    );
    return sortStates(states, options.sortBy ?? "id");
  }

  deriveForDepartment(
    department: string,
    source: OperationalSourcePort,
    options: RegistryOptions = {},
  ): readonly DerivedCapabilityState[] {
    const states = this.listForDepartment(department).map((capability) =>
      deriveCapabilityState(capability, source),
    );
    return sortStates(states, options.sortBy ?? "id");
  }

  isReady(id: string, source: OperationalSourcePort): boolean {
    const capability = this.get(id);
    if (!capability) return false;
    return deriveCapabilityState(capability, source).status === "ready";
  }
}

function sortStates(
  states: readonly DerivedCapabilityState[],
  sortBy: RegistrySort,
): readonly DerivedCapabilityState[] {
  const sorted = [...states];
  switch (sortBy) {
    case "source":
      return sorted.sort((a, b) =>
        a.capability.source.localeCompare(b.capability.source),
      );
    case "status":
      return sorted.sort((a, b) => a.status.localeCompare(b.status));
    case "department":
      return sorted.sort((a, b) =>
        a.capability.department.localeCompare(b.capability.department),
      );
    case "id":
    default:
      return sorted.sort((a, b) => a.capability.id.localeCompare(b.capability.id));
  }
}

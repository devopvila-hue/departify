import { assertRuntimeValid } from "../validation/runtime-error.js";

export const agentPermissionScopes = [
  "organization",
  "workspace",
  "department",
  "runtime",
] as const;

export const agentPermissionActions = [
  "read",
  "write",
  "execute",
  "manage",
] as const;

export type AgentPermissionScope = (typeof agentPermissionScopes)[number];
export type AgentPermissionAction = (typeof agentPermissionActions)[number];

export interface AgentPermission {
  scope: AgentPermissionScope;
  action: AgentPermissionAction;
  resource: string;
}

export interface AgentPermissionSet {
  permissions: readonly AgentPermission[];
}

export function createAgentPermissionSet(
  permissions: readonly AgentPermission[],
): AgentPermissionSet {
  for (const permission of permissions) {
    assertRuntimeValid(
      agentPermissionScopes.includes(permission.scope),
      "Agent permission scope is invalid.",
    );
    assertRuntimeValid(
      agentPermissionActions.includes(permission.action),
      "Agent permission action is invalid.",
    );
    assertRuntimeValid(
      permission.resource.trim().length > 0,
      "Agent permission resource is required.",
    );
  }

  return { permissions: [...permissions] };
}

export function hasAgentPermission(
  permissionSet: AgentPermissionSet,
  permission: AgentPermission,
): boolean {
  return permissionSet.permissions.some(
    (candidate) =>
      candidate.scope === permission.scope &&
      candidate.action === permission.action &&
      (candidate.resource === permission.resource ||
        candidate.resource === "*"),
  );
}

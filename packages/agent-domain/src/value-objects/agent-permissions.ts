import { assertAgentDomainInvariant } from "../validation/domain-error.js";

export const agentPermissionScopes = [
  "organization",
  "department",
  "workspace",
  "agent",
] as const;

export type AgentPermissionScope = (typeof agentPermissionScopes)[number];

export const agentPermissionActions = [
  "read",
  "write",
  "execute",
  "manage",
] as const;

export type AgentPermissionAction = (typeof agentPermissionActions)[number];

export interface AgentPermission {
  scope: AgentPermissionScope;
  action: AgentPermissionAction;
}

export interface AgentPermissionsSnapshot {
  items: readonly AgentPermission[];
}

export class AgentPermissions {
  private constructor(private readonly items: readonly AgentPermission[]) {}

  static create(snapshot: AgentPermissionsSnapshot): AgentPermissions {
    assertAgentDomainInvariant(
      snapshot.items.length <= 100,
      "AgentPermissions cannot contain more than 100 permissions.",
    );

    const uniqueKeys = new Set<string>();
    snapshot.items.forEach((permission) => {
      assertAgentDomainInvariant(
        agentPermissionScopes.includes(permission.scope),
        "AgentPermission scope is invalid.",
      );
      assertAgentDomainInvariant(
        agentPermissionActions.includes(permission.action),
        "AgentPermission action is invalid.",
      );

      const key = `${permission.scope}:${permission.action}`;
      assertAgentDomainInvariant(
        !uniqueKeys.has(key),
        "AgentPermissions cannot contain duplicate permissions.",
      );
      uniqueKeys.add(key);
    });

    return new AgentPermissions(snapshot.items.map((item) => ({ ...item })));
  }

  allows(permission: AgentPermission): boolean {
    return this.items.some(
      (candidate) =>
        candidate.scope === permission.scope &&
        candidate.action === permission.action,
    );
  }

  toSnapshot(): AgentPermissionsSnapshot {
    return {
      items: this.items.map((item) => ({ ...item })),
    };
  }
}

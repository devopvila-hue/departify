/**
 * Deterministic fake tenant service for route-level tests — P0-A.
 *
 * Implements both the AuthService (verify + membership) and OrganizationStore
 * (create + list) so the security boundary can be exercised without a real
 * Supabase project. Test-only.
 */

import {
  AuthError,
  type AuthenticatedUser,
  type AuthService,
  type OrganizationMembership,
} from "@departify/auth";
import type {
  OrganizationStore,
  OrganizationSummary,
} from "../../src/auth/tenant-contracts.js";

export interface FakeTenantConfig {
  readonly users: ReadonlyArray<readonly [token: string, user: AuthenticatedUser]>;
  readonly memberships?: readonly OrganizationMembership[];
}

export class FakeTenantService implements AuthService, OrganizationStore {
  private readonly users: ReadonlyMap<string, AuthenticatedUser>;
  private readonly memberships: OrganizationMembership[];
  private readonly names = new Map<string, string>();
  private counter = 0;

  constructor(config: FakeTenantConfig) {
    this.users = new Map(config.users);
    this.memberships = [...(config.memberships ?? [])];
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const user = this.users.get(token);
    if (!user) {
      throw new AuthError("invalid_token", "invalid token");
    }
    return user;
  }

  async resolveMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    return (
      this.memberships.find(
        (membership) =>
          membership.userId === userId &&
          membership.organizationId === organizationId,
      ) ?? null
    );
  }

  async createOrganization(
    name: string,
    ownerId: string,
  ): Promise<OrganizationSummary> {
    this.counter += 1;
    const organizationId = `org_${this.counter}`;
    this.names.set(organizationId, name);
    this.memberships.push({
      organizationId,
      userId: ownerId,
      role: "owner",
    });
    return { organizationId, name, role: "owner" };
  }

  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    return this.memberships
      .filter((membership) => membership.userId === userId)
      .map((membership) => ({
        organizationId: membership.organizationId,
        name:
          this.names.get(membership.organizationId) ?? membership.organizationId,
        role: membership.role,
      }));
  }

  membershipsOf(userId: string): readonly OrganizationMembership[] {
    return this.memberships.filter(
      (membership) => membership.userId === userId,
    );
  }
}

/** Two users, each owning their own organization (A owns org-a, B owns org-b). */
export function makeFakeTenant(): FakeTenantService {
  return new FakeTenantService({
    users: [
      ["token-a", { id: "user-a", email: "a@example.com" }],
      ["token-b", { id: "user-b", email: "b@example.com" }],
    ],
    memberships: [
      { organizationId: "org-a", userId: "user-a", role: "owner" },
      { organizationId: "org-b", userId: "user-b", role: "member" },
    ],
  });
}

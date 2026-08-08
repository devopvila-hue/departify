/**
 * Auth domain contracts — Phase P0-A.
 *
 * Framework-independent identity and tenant authorization model. This package
 * deliberately holds NO provider SDK and NO HTTP layer: it is the boundary the
 * backend adapts Supabase Auth to. Identity is verified server-side, never
 * trusted from the browser.
 */

/** A verified authenticated user. `id` is the Supabase `auth.users.id`. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly email?: string;
}

export type OrganizationRole = "owner" | "member";

/** Durable membership of a user in an organization (authorization fact). */
export interface OrganizationMembership {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
}

/** The result of asserting organization access for a request. */
export interface AuthContext {
  readonly user: AuthenticatedUser;
  readonly organizationId: string;
  readonly membership: OrganizationMembership;
}

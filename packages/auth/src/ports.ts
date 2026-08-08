/**
 * Auth ports — Phase P0-A.
 *
 * The authorization logic depends on these narrow ports, never on Supabase or
 * Fastify. The backend supplies Supabase-backed implementations.
 */

import type {
  AuthenticatedUser,
  OrganizationMembership,
} from "./contracts.js";

/** Verifies a Bearer access token server-side and returns the user. */
export interface IdentityVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser>;
}

/** Resolves a user's membership in an organization (authorization fact). */
export interface MembershipResolver {
  resolveMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null>;
}

/** The full identity + membership surface the transport boundary needs. */
export interface AuthService extends IdentityVerifier, MembershipResolver {}

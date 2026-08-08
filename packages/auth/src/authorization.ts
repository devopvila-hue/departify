/**
 * Authorization functions — Phase P0-A.
 *
 * The single, framework-independent enforcement path:
 *
 *   Authorization header
 *       → Bearer token
 *       → server-side verification
 *       → authenticated user id
 *       → organization membership lookup
 *       → ALLOW (AuthContext) or throw AuthError
 *
 * Changing `:organizationId` in a URL NEVER grants access unless the
 * authenticated user belongs to that organization.
 */

import { AuthError } from "./errors.js";
import type { AuthContext, AuthenticatedUser } from "./contracts.js";
import type { AuthService } from "./ports.js";

/** Extracts a Bearer token from a raw Authorization header value. */
export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const parts = authorizationHeader.trim().split(/\s+/);
  const [scheme, token, ...rest] = parts;
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
    return null;
  }
  return token;
}

/** Verifies the request identity from the Authorization header. */
export async function authenticateToken(
  auth: AuthService,
  authorizationHeader: string | undefined,
): Promise<AuthenticatedUser> {
  const token = extractBearerToken(authorizationHeader);
  if (!token) {
    throw new AuthError("missing_token", "Missing authentication token.");
  }
  return auth.verifyAccessToken(token);
}

/**
 * Verifies identity AND resolves the requested organization's membership.
 * Throws AuthError (401/403) when the caller is not allowed. This MUST run
 * before any tenant business logic.
 */
export async function assertOrganizationAccess(
  auth: AuthService,
  authorizationHeader: string | undefined,
  organizationId: string,
): Promise<AuthContext> {
  const user = await authenticateToken(auth, authorizationHeader);
  const membership = await auth.resolveMembership(user.id, organizationId);
  if (!membership) {
    // Generic denial: the caller could be a non-member OR the organization
    // could not exist. Never reveal which.
    throw new AuthError(
      "forbidden",
      "Not authorized for this organization.",
    );
  }
  return { user, organizationId, membership };
}

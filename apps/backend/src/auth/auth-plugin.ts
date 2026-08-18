/**
 * Fastify auth boundary — Phase P0-A.
 *
 * A single, central enforcement point applied to every non-public route:
 *
 *   1. Public paths stay public: /health, /version, /documentation.
 *   2. Routes carrying `:organizationId` require identity AND membership.
 *   3. Every other protected route requires a valid identity only.
 *
 * Authorization runs BEFORE any business logic. Missing/invalid/expired
 * tokens → 401; missing membership → 403. Responses are generic and never
 * leak whether an organization exists.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import {
  AuthError,
  assertOrganizationAccess,
  authenticateToken,
  type AuthContext,
  type AuthenticatedUser,
  type AuthService,
} from "@departify/auth";

declare module "fastify" {
  interface FastifyRequest {
    /** Verified identity for authenticated requests. */
    authUser?: AuthenticatedUser;
    /** Verified identity + membership for tenant-scoped requests. */
    authContext?: AuthContext;
  }
}

const PUBLIC_PATHS = new Set(["/health", "/version"]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Native Departify tool endpoints have their own HMAC runtime identity. Do
  // not force them through CEO bearer auth, which would make the OpenClaw
  // gateway present a Supabase user token. The route handler remains fail
  // closed and validates the scoped token before reading any tenant state.
  if (pathname.startsWith("/internal/native-tools/")) return true;
  if (pathname.startsWith("/connections/") && pathname.endsWith("/callback")) return true;
  if (pathname === "/documentation" || pathname.startsWith("/documentation/")) {
    return true;
  }
  return false;
}

export function registerAuthBoundary(
  server: FastifyInstance,
  auth: AuthService,
): void {
  server.addHook("onRequest", async (request, reply) => {
    const pathname = request.url.split("?")[0] ?? "";
    if (isPublicPath(pathname)) return;

    const params = request.params as { organizationId?: string };

    if (params.organizationId) {
      try {
        const context = await assertOrganizationAccess(
          auth,
          request.headers.authorization,
          params.organizationId,
        );
        request.authContext = context;
        request.authUser = context.user;
      } catch (cause) {
        if (cause instanceof AuthError) {
          deny(reply, cause.statusCode, cause.code, request.id);
          return;
        }
        request.log.error({ error: cause }, "Authorization check failed");
        deny(reply, 500, "AUTH_INTERNAL_ERROR", request.id);
        return;
      }
      return;
    }

    try {
      request.authUser = await authenticateToken(
        auth,
        request.headers.authorization,
      );
    } catch (cause) {
      if (cause instanceof AuthError) {
        deny(reply, cause.statusCode, cause.code, request.id);
        return;
      }
      request.log.error({ error: cause }, "Authentication failed");
      deny(reply, 500, "AUTH_INTERNAL_ERROR", request.id);
      return;
    }
  });
}

function deny(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  requestId: string,
): void {
  const message = statusCode === 403 ? "Not authorized." : "Authentication failed.";
  reply.code(statusCode).send({
    error: { code, message, requestId, statusCode },
  });
}

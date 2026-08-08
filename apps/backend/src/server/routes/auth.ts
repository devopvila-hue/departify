/**
 * Auth routes — Phase P0-A.
 *
 *   GET  /api/auth/me            → the authenticated user + their organizations
 *   POST /api/auth/organizations → create a real organization (owner member)
 *
 * Both require a valid Bearer token (enforced centrally by the auth
 * boundary). Organization ownership is decided server-side from the verified
 * user id — never from the browser.
 */

import type { FastifyInstance } from "fastify";
import type { OrganizationStore } from "../../auth/tenant-contracts.js";

export async function registerAuthRoutes(
  server: FastifyInstance,
  organizations: OrganizationStore | undefined,
): Promise<void> {
  server.get(
    "/api/auth/me",
    {
      schema: {
        tags: ["auth"],
        summary: "The authenticated user and their organizations",
        response: {
          200: {
            type: "object",
            required: ["user", "organizations"],
            properties: {
              user: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                },
              },
              organizations: {
                type: "array",
                items: {
                  type: "object",
                  required: ["organizationId", "name", "role"],
                  properties: {
                    organizationId: { type: "string" },
                    name: { type: "string" },
                    role: { type: "string" },
                  },
                },
              },
            },
          },
          503: {
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                  statusCode: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser;
      if (!user || !organizations) {
        return reply.code(503).send({
          error: {
            code: "AUTH_UNAVAILABLE",
            message: "Authentication is not configured.",
            requestId: request.id,
            statusCode: 503,
          },
        });
      }
      const list = await organizations.listForUser(user.id);
      return reply.code(200).send({
        user: {
          id: user.id,
          ...(user.email ? { email: user.email } : {}),
        },
        organizations: list,
      });
    },
  );

  server.post(
    "/api/auth/organizations",
    {
      schema: {
        tags: ["auth"],
        summary: "Create an organization with the caller as owner",
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          201: {
            type: "object",
            required: ["organizationId", "name", "role"],
            properties: {
              organizationId: { type: "string" },
              name: { type: "string" },
              role: { type: "string" },
            },
          },
          400: {
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                  statusCode: { type: "number" },
                },
              },
            },
          },
          500: {
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                  statusCode: { type: "number" },
                },
              },
            },
          },
          503: {
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                  statusCode: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser;
      if (!user || !organizations) {
        return reply.code(503).send({
          error: {
            code: "AUTH_UNAVAILABLE",
            message: "Authentication is not configured.",
            requestId: request.id,
            statusCode: 503,
          },
        });
      }
      const body = request.body as { name: string };
      const name = body.name.trim();
      if (name.length === 0) {
        return reply.code(400).send({
          error: {
            code: "INVALID_ORGANIZATION_NAME",
            message: "Organization name is required.",
            requestId: request.id,
            statusCode: 400,
          },
        });
      }
      try {
        const organization = await organizations.createOrganization(
          name,
          user.id,
        );
        return reply.code(201).send({
          organizationId: organization.organizationId,
          name: organization.name,
          role: organization.role,
        });
      } catch (cause) {
        request.log.error({ error: cause }, "Organization creation failed");
        return reply.code(500).send({
          error: {
            code: "ORGANIZATION_CREATION_FAILED",
            message: "Could not create the organization.",
            requestId: request.id,
            statusCode: 500,
          },
        });
      }
    },
  );
}

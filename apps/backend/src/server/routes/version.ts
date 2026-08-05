import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";

export async function registerVersionRoutes(
  server: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  server.get(
    "/version",
    {
      schema: {
        tags: ["system"],
        summary: "Backend version metadata",
        response: {
          200: {
            type: "object",
            required: ["name", "version", "environment"],
            properties: {
              name: { type: "string" },
              version: { type: "string" },
              environment: { type: "string" },
            },
          },
        },
      },
    },
    async () => ({
      name: config.name,
      version: config.version,
      environment: config.environment,
    }),
  );
}

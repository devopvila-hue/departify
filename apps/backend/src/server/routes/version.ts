import type { BackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";

export async function registerVersionRoutes(
  server: FastifyInstance,
  config: BackendConfig,
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

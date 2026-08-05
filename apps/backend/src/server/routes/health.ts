import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(
  server: FastifyInstance,
): Promise<void> {
  server.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Backend health status",
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: {
              status: { type: "string", enum: ["ok"] },
            },
          },
        },
      },
    },
    async () => ({ status: "ok" as const }),
  );
}

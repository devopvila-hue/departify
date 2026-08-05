import type { BackendConfig } from "@departify/config";
import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

import { registerErrorHandling } from "./errors.js";
import { registerOpenApi } from "./openapi.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerVersionRoutes } from "./routes/version.js";

export async function buildServer(
  config: BackendConfig,
): Promise<FastifyInstance> {
  const server = fastify({
    logger: {
      level: config.logLevel,
    },
    requestIdHeader: "x-request-id",
    genReqId: (request) => {
      const header = request.headers["x-request-id"];
      if (typeof header === "string" && header.trim().length > 0) {
        return header;
      }

      return randomUUID();
    },
  });

  server.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  registerErrorHandling(server);
  await registerOpenApi(server, config);
  await registerHealthRoutes(server);
  await registerVersionRoutes(server, config);

  return server;
}

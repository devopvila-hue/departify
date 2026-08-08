import type { BackendConfig } from "@departify/config";
import fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";

import { registerAuthBoundary } from "../auth/index.js";
import { registerErrorHandling } from "./errors.js";
import { registerOpenApi } from "./openapi.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerVersionRoutes } from "./routes/version.js";
import { registerCustomerZeroRoutes } from "./routes/customer-zero.js";
import { registerCustomerZeroV2Routes } from "./routes/customer-zero-v2.js";
import { registerAuthRoutes } from "./routes/auth.js";
import type { ServerDeps } from "./deps.js";

export async function buildServer(
  config: BackendConfig,
  deps: ServerDeps = {},
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

  // Explicit allowed-origin CORS. Empty config = same-origin only (no plugin).
  if (config.corsAllowedOrigins.length > 0) {
    await server.register(cors, { origin: config.corsAllowedOrigins });
  }

  // Central authentication / tenant authorization boundary.
  if (deps.auth) {
    registerAuthBoundary(server, deps.auth);
  }

  registerErrorHandling(server);
  await registerOpenApi(server, config);
  await registerHealthRoutes(server);
  await registerVersionRoutes(server, config);
  await registerCustomerZeroRoutes(server);
  await registerCustomerZeroV2Routes(server, deps);
  await registerAuthRoutes(server, deps.organizations);

  return server;
}

import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";

import type { AppConfig } from "./config.js";

export async function registerOpenApi(
  server: FastifyInstance,
  config: AppConfig,
): Promise<void> {
  await server.register(swagger, {
    openapi: {
      info: {
        title: "Departify Backend",
        description:
          "Technical API surface for the Departify V2 backend foundation.",
        version: config.version,
      },
    },
  });

  await server.register(swaggerUi, {
    routePrefix: "/documentation",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
  });
}

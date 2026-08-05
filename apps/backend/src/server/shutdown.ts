import type { FastifyInstance } from "fastify";

import type { AppConfig } from "./config.js";

const shutdownSignals = ["SIGINT", "SIGTERM"] as const;

export function registerGracefulShutdown(
  server: FastifyInstance,
  config: AppConfig,
): void {
  for (const signal of shutdownSignals) {
    process.once(signal, () => {
      void shutdown(server, config, signal);
    });
  }
}

async function shutdown(
  server: FastifyInstance,
  config: AppConfig,
  signal: (typeof shutdownSignals)[number],
): Promise<void> {
  server.log.info(
    { signal, environment: config.environment },
    "Backend shutdown started",
  );

  try {
    await server.close();
    server.log.info({ signal }, "Backend shutdown completed");
    process.exitCode = 0;
  } catch (error) {
    server.log.error({ error, signal }, "Backend shutdown failed");
    process.exitCode = 1;
  }
}

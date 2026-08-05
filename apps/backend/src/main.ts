import { loadBackendConfig } from "@departify/config";
import { buildServer } from "./server/server.js";
import { registerGracefulShutdown } from "./server/shutdown.js";

const config = loadBackendConfig();
const server = await buildServer(config);

registerGracefulShutdown(server, config);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error({ error }, "Backend failed to start");
  process.exitCode = 1;
}

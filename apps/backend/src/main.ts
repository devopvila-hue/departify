import { loadConfig } from "./server/config.js";
import { buildServer } from "./server/server.js";
import { registerGracefulShutdown } from "./server/shutdown.js";

const config = loadConfig();
const server = await buildServer(config);

registerGracefulShutdown(server, config);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error({ error }, "Backend failed to start");
  process.exitCode = 1;
}

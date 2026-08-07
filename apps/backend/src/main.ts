import { loadBackendConfig } from "@departify/config";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildServer } from "./server/server.js";
import { registerGracefulShutdown } from "./server/shutdown.js";

// Load the local environment file when present. The backend does not ship
// secrets; local development reads them from `.env` at the repo root.
const envFile = new URL("../../../.env", import.meta.url).pathname;
if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const config = loadBackendConfig();
const server = await buildServer(config);

registerGracefulShutdown(server, config);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error({ error }, "Backend failed to start");
  process.exitCode = 1;
}

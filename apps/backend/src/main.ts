import {
  loadAuthConfig,
  loadBackendConfig,
  type BackendConfig,
} from "@departify/config";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildServer } from "./server/server.js";
import { registerGracefulShutdown } from "./server/shutdown.js";
import { SupabaseTenantService } from "./auth/supabase-tenant-service.js";
import { SupabaseToolStateStore } from "./customer-zero/supabase-tool-state-store.js";
import { SupabaseConversationStore } from "./customer-zero/supabase-conversation-store.js";
import type { ServerDeps } from "./server/deps.js";

// Load the local environment file when present. The backend does not ship
// secrets; local development reads them from `.env` at the repo root.
const envFile = new URL("../../../.env", import.meta.url).pathname;
if (existsSync(envFile)) {
  loadEnvFile(envFile);
}

const config: BackendConfig = loadBackendConfig();

// Wire the real Supabase Auth identity + tenant boundary. In production a
// missing auth configuration is fatal (fail closed); elsewhere it is logged
// loudly so local development can still run without forcing Supabase up.
const deps: ServerDeps = config.publicBaseUrl
  ? { publicBaseUrl: config.publicBaseUrl }
  : {};
try {
  const authConfig = loadAuthConfig();
  const tenant = new SupabaseTenantService(authConfig);
  deps.auth = tenant;
  deps.organizations = tenant;
  deps.toolState = new SupabaseToolStateStore(authConfig);
  deps.conversations = new SupabaseConversationStore(authConfig);
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (config.environment === "production") {
    throw new Error(
      `Authentication is required in production (${message}). ` +
        "Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  console.warn(
    `[auth] Supabase auth is not configured (${message}). ` +
      "Routes will be unprotected in non-production environments.",
  );
}

const server = await buildServer(config, deps);

registerGracefulShutdown(server, config);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error({ error }, "Backend failed to start");
  process.exitCode = 1;
}

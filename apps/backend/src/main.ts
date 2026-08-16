import {
  loadAuthConfig,
  loadBackendConfig,
  loadEngineAdapterConfig,
  type BackendConfig,
} from "@departify/config";
import { createEngineAdapter } from "@departify/engine-adapter";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { buildServer } from "./server/server.js";
import { registerGracefulShutdown } from "./server/shutdown.js";
import { SupabaseTenantService } from "./auth/supabase-tenant-service.js";
import { SupabaseToolStateStore } from "./customer-zero/supabase-tool-state-store.js";
import { SupabaseConversationStore } from "./customer-zero/supabase-conversation-store.js";
import { SupabaseInboxStore } from "./customer-zero/supabase-inbox-store.js";
import { SupabaseDepartmentWorkStore } from "./customer-zero/supabase-department-work-store.js";
import { SupabaseDepartmentDashboardStore } from "./customer-zero/department-dashboards.js";
import { SupabaseCompanyDnaStore } from "./customer-zero/supabase-company-dna-store.js";
import { SupabaseDepartmentMemoryStore } from "./customer-zero/department-memory.js";
import {
  SupabaseGoogleTokenStore,
  setGoogleTokenStore,
} from "./customer-zero/google-tokens.js";
import {
  SupabaseOAuthStateStore,
  setGoogleOAuthStateStore,
} from "./customer-zero/oauth-state.js";
import {
  SupabaseExternalOAuthTokenStore,
  setExternalOAuthTokenStore,
} from "./customer-zero/external-oauth-tokens.js";
import {
  SupabaseCorporateEmailStore,
  setCorporateEmailStore,
} from "./customer-zero/corporate-email-store.js";
import {
  getCustomerZeroReportRepository,
  listCustomerZeroSessions,
} from "./customer-zero/customer-zero-session.js";
import type { DiscoveryReportRepository } from "@departify/business-discovery";
import {
  SupabaseMarketingActivityRepository,
  SupabaseMarketingApprovalRepository,
  SupabaseMarketingObjectiveRepository,
} from "./customer-zero/supabase-marketing-repositories.js";
import { MarketingService } from "./customer-zero/marketing-service.js";
import { SupabaseSeoRepositoryLinkStore, setSeoRepositoryLinkStore } from "./customer-zero/seo-repository.js";
import type { ServerDeps } from "./server/deps.js";
import {
  createActivepiecesConnectorRuntime,
  createConnectorRuntimeCandidates,
} from "./customer-zero/activepieces-connector.js";
import {
  MarketingConnectorRuntime,
  SupabaseMarketingConnectorStore,
  setMarketingConnectorStore,
} from "./customer-zero/marketing-connector.js";

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

// Activepieces is a separate connector runtime. It receives only
// tenant-bound business inputs; provider credentials remain inside the
// Activepieces connection/flow and never enter OpenClaw.
deps.connectorRuntime = createActivepiecesConnectorRuntime((event) => {
  console.log("[connector-runtime]", JSON.stringify(event));
});
deps.connectorRuntimes = createConnectorRuntimeCandidates((event) => {
  console.log("[connector-runtime]", JSON.stringify(event));
});
deps.marketingConnectorRuntime = new MarketingConnectorRuntime();

// Supabase auth identity + tenant boundary (resolved first so the Marketing
// durable repositories can be wired). In production a missing auth config is
// fatal (fail closed); elsewhere it is logged loudly so local development can
// still run without forcing Supabase up.
let supabaseAuthConfig: ReturnType<typeof loadAuthConfig> | null = null;
try {
  supabaseAuthConfig = loadAuthConfig();
  const tenant = new SupabaseTenantService(supabaseAuthConfig);
  deps.auth = tenant;
  deps.organizations = tenant;
  deps.toolState = new SupabaseToolStateStore(supabaseAuthConfig);
  deps.conversations = new SupabaseConversationStore(supabaseAuthConfig);
  deps.inbox = new SupabaseInboxStore(supabaseAuthConfig);
  deps.workStore = new SupabaseDepartmentWorkStore(supabaseAuthConfig);
  deps.dashboardStore = new SupabaseDepartmentDashboardStore(supabaseAuthConfig);
  deps.seoRepositoryLinks = new SupabaseSeoRepositoryLinkStore(supabaseAuthConfig);
  setSeoRepositoryLinkStore(deps.seoRepositoryLinks);
  deps.marketingActivity = new SupabaseMarketingActivityRepository(supabaseAuthConfig);
  // Durable canonical Company DNA (Customer Zero P0). Company
  // understanding MUST survive Railway backend restarts — the readiness
  // gate is evaluated against this store, never against process memory.
  deps.companyDna = new SupabaseCompanyDnaStore(supabaseAuthConfig);
  deps.departmentMemory = new SupabaseDepartmentMemoryStore(supabaseAuthConfig);
  // Durable Google OAuth token persistence. Required in production —
  // tokens MUST survive Railway backend restarts. The in-memory
  // fallback is dev / tests only.
  setGoogleTokenStore(new SupabaseGoogleTokenStore(supabaseAuthConfig));
  console.log(
    `[google-oauth] durable Supabase token store wired`,
  );
  // Durable OAuth state nonce store. REQUIRED in production: the
  // callback must resolve the state nonce on ANY replica/restart —
  // an in-memory store produces the silent consent loop across
  // instances.
  setGoogleOAuthStateStore(new SupabaseOAuthStateStore(supabaseAuthConfig));
  console.log(
    `[google-oauth] durable Supabase oauth-state store wired`,
  );
  setExternalOAuthTokenStore(
    new SupabaseExternalOAuthTokenStore(supabaseAuthConfig),
  );
  console.log(
    `[external-oauth] durable Meta/TickTick token store wired`,
  );
  // Durable corporate email accounts (IMAP/SMTP). Same security
  // pattern: service-role only, RLS block-all, org+user scoped.
  setCorporateEmailStore(
    new SupabaseCorporateEmailStore(supabaseAuthConfig),
  );
  console.log(
    `[corporate-email] durable Supabase account store wired`,
  );
  setMarketingConnectorStore(new SupabaseMarketingConnectorStore(supabaseAuthConfig));
  console.log(`[marketing-connectors] durable Supabase credential store wired`);
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

// A marketing delegation currently runs in-process, while its task state is
// durable. On boot, close only tasks whose own persisted deadline elapsed so
// a deploy/restart cannot leave the portal showing invented "working" state.
if (deps.workStore) {
  try {
    const recovered = await deps.workStore.recoverExpiredTasks();
    if (recovered > 0) {
      console.warn(`[department-work] recovered ${recovered} expired task(s) after boot`);
    }
  } catch (cause) {
    console.warn(
      `[department-work] boot recovery unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

// Engine Adapter (Sprint ENGINE 02). Only wired when the gateway URL is
// configured; otherwise the backend runs without an engine and product routes
// that need one fail with a clear configuration error.
try {
  const engineConfig = loadEngineAdapterConfig();
  if (engineConfig.gatewayUrl) {
    deps.engine = createEngineAdapter(engineConfig);
    deps.engineRuntimePolicy = engineConfig.runtimePolicy ?? "strict";
    deps.nativeBusinessTools = /^(1|true|yes|on)$/i.test(
      process.env.OPENCLAW_NATIVE_BUSINESS_TOOLS ?? "",
    );
    console.log(
      `[engine] adapter initialised provider=${engineConfig.provider} url=${engineConfig.gatewayUrl} policy=${engineConfig.runtimePolicy}`,
    );
    // DEPLOY 01: durable Marketing state via Supabase when auth is available;
    // otherwise in-memory repositories (dev/test only).
    const marketing = supabaseAuthConfig
      ? new MarketingService({
          engine: deps.engine,
          // Business context is pulled lazily from the org's Customer Zero
          // session (created during onboarding).
          reportRepository: createLazyReportRepository(),
          objectives: new SupabaseMarketingObjectiveRepository(supabaseAuthConfig),
          ...(deps.marketingActivity ? { activity: deps.marketingActivity } : {}),
          approvals: new SupabaseMarketingApprovalRepository(supabaseAuthConfig),
          ...(deps.companyDna ? { companyDna: deps.companyDna } : {}),
          ...(deps.workStore ? { workStore: deps.workStore } : {}),
          ...(deps.toolState ? { toolState: deps.toolState } : {}),
        })
      : new MarketingService({
          engine: deps.engine,
          reportRepository: createLazyReportRepository(),
        });
    deps.marketing = marketing;
    console.log(
      `[engine] marketing service initialised (Elvira via EngineAdapter; durable=${Boolean(supabaseAuthConfig)})`,
    );
  }
} catch (cause) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.warn(`[engine] adapter not configured (${message}).`);
}

/**
 * A DiscoveryReportRepository that lazily resolves the org's Customer Zero
 * session repository. Before a session exists it returns empty/absent reads.
 */
function createLazyReportRepository(): DiscoveryReportRepository {
  const noop = () => [];
  const sessionRepo = (organizationId: string) =>
    getCustomerZeroReportRepository(organizationId);
  return {
    save(record) {
      sessionRepo(record.organizationId)?.save(record);
    },
    findById(id) {
      // findById across orgs is not meaningful here; fall back to a scan.
      for (const org of listCustomerZeroSessions()) {
        const repo = sessionRepo(org);
        const found = repo?.findById(id);
        if (found) return found;
      }
      return null;
    },
    findByOrganizationId(organizationId) {
      return (
        sessionRepo(organizationId)?.findByOrganizationId(organizationId) ??
        noop()
      );
    },
    list() {
      return noop();
    },
  };
}

const server = await buildServer(config, deps);

registerGracefulShutdown(server, config);

try {
  await server.listen({ host: config.host, port: config.port });
} catch (error) {
  server.log.error({ error }, "Backend failed to start");
  process.exitCode = 1;
}

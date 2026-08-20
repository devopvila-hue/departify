#!/usr/bin/env node
/**
 * Departify Engine — OpenClaw config renderer
 *
 * Renders /home/node/.openclaw/openclaw.json from environment variables.
 * Pure function: idempotent, no side effects beyond the target file.
 *
 * Exit codes:
 *   0  - rendered successfully
 *   1  - missing required input
 *   2  - invalid configuration value
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH || join(STATE_DIR, "openclaw.json");

const required = (name) => {
  const v = process.env[name];
  if (v == null || v === "") {
    console.error(`[render-config] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
};
const optional = (name, fallback) => {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
};
const bool = (name, fallback) => {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
};
const int = (name, fallback) => {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    console.error(`[render-config] ${name} must be an integer, got: ${v}`);
    process.exit(2);
  }
  return n;
};
const csv = (name) => {
  const v = optional(name, "");
  return v
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
};

/* ------------------------- engine identity ------------------------- */

const engineVersion = "engine-01-2026.08.09";
const openclawVersion = optional("OPENCLAW_VERSION", "v2026.7.1-2");
const openclawImage = optional(
  "OPENCLAW_IMAGE",
  "ghcr.io/openclaw/openclaw:2026.7.1-2-slim",
);
const gatewayBind = optional("OPENCLAW_GATEWAY_BIND", "lan");
const gatewayPort = int("OPENCLAW_GATEWAY_PORT", 18789);
const gatewayToken = required("OPENCLAW_GATEWAY_TOKEN");
// Default provider is Google Vertex (managed cloud, ADC). Ollama is the
// optional local fallback. Both are official OpenClaw provider plugins.
const modelProvider = optional("OPENCLAW_MODEL_PROVIDER", "google-vertex");
const modelName = optional("OPENCLAW_MODEL_NAME", "gemini-2.5-flash");
const modelBaseUrl = optional("OPENCLAW_MODEL_BASE_URL", "");
const modelApiKey = optional("OPENCLAW_MODEL_API_KEY", "");
// Railway does not provide host.docker.internal/Ollama. An explicit
// disabled/none/off value removes the fallback instead of silently routing a
// production run to a provider that cannot exist in that environment.
const fallbackSetting = process.env.OPENCLAW_FALLBACK_PROVIDER;
const fallbackDisabled = /^(disabled|none|off)$/i.test(fallbackSetting ?? "");
const fallbackProvider = fallbackDisabled
  ? ""
  : optional("OPENCLAW_FALLBACK_PROVIDER", "ollama");
const fallbackModel = fallbackProvider
  ? optional("OPENCLAW_FALLBACK_MODEL", "qwen3:0.6b")
  : "";
const fallbackBaseUrl = optional(
  "OPENCLAW_FALLBACK_BASE_URL",
  "http://host.docker.internal:11434/v1",
);
const fallbackApiKey = optional("OPENCLAW_FALLBACK_API_KEY", "ollama");
const workspaceDir = optional(
  "OPENCLAW_WORKSPACE_DIR",
  join(STATE_DIR, "workspace"),
);
const disableBonjour = bool("OPENCLAW_DISABLE_BONJOUR", true);
const enableSandbox = bool("OPENCLAW_SANDBOX", false);
const enableBrowser = bool("OPENCLAW_INSTALL_BROWSER", false);
const enableTailscale = bool("OPENCLAW_ENABLE_TAILSCALE", false);
const allowInsecurePrivateWs = bool(
  "OPENCLAW_ALLOW_INSECURE_PRIVATE_WS",
  false,
);
const dmScope = optional("OPENCLAW_DM_SCOPE", "main");
const resetMode = optional("OPENCLAW_SESSION_RESET_MODE", "none");
const resetAtHour = int("OPENCLAW_SESSION_RESET_AT_HOUR", 4);
const resetIdleMinutes = int("OPENCLAW_SESSION_RESET_IDLE_MINUTES", 120);
const logLevel = optional("OPENCLAW_LOG_LEVEL", "info");
// Admin HTTP RPC (bundled plugin) — opt-in for headless provisioning flows
// (e.g. one-time device pairing approval). Disabled by default in production.
// Never leave enabled; remove the env var after use.
const enableAdminHttpRpc = bool("OPENCLAW_ENABLE_ADMIN_HTTP_RPC", false);
const enableNativeBusinessTools = bool("OPENCLAW_NATIVE_BUSINESS_TOOLS", false);
// Founder parity is an explicit environment boundary. Other modes retain the
// existing restricted policy until the separate production hardening sprint.
const runtimeMode = optional("DEPARTIFY_OPENCLAW_MODE", "production");
const founderParity = runtimeMode === "founder-development";
const departifyApiUrl = optional("DEPARTIFY_API_URL", "");
const departifyRuntimeToken = optional("DEPARTIFY_RUNTIME_TOKEN", "");
if (enableNativeBusinessTools && (!departifyApiUrl || !departifyRuntimeToken)) {
  console.error(
    "[render-config] native business tools require DEPARTIFY_API_URL and DEPARTIFY_RUNTIME_TOKEN",
  );
  process.exit(1);
}
const maxTokens = int("OPENCLAW_MAX_TOKENS", 2048);
const contextTokens = int("OPENCLAW_CONTEXT_TOKENS", 131072);
const compactionKeepRecentTokens = int(
  "OPENCLAW_COMPACTION_KEEP_RECENT_TOKENS",
  50000,
);
const compactionRecentTurns = int("OPENCLAW_COMPACTION_RECENT_TURNS", 3);
const compactionTimeoutSeconds = int(
  "OPENCLAW_COMPACTION_TIMEOUT_SECONDS",
  180,
);
const compactionMaxActiveTranscriptBytes = optional(
  "OPENCLAW_COMPACTION_MAX_ACTIVE_TRANSCRIPT_BYTES",
  "20mb",
);
const temperature = Number.parseFloat(optional("OPENCLAW_TEMPERATURE", "0.2"));
const requestTimeoutSec = int("OPENCLAW_REQUEST_TIMEOUT_SECONDS", 300);
const exposePublic = bool("OPENCLAW_EXPOSE_PUBLIC", false);
const trustedProxies = csv("OPENCLAW_TRUSTED_PROXIES");
// Exec policy. Default "test" enables a safe, headless-friendly surface for the
// Sprint 1 tool probe: exec allowed for safe commands, no human approval
// (the engine is private + token-auth). Set to "locked" to deny exec entirely.
const execMode = optional("OPENCLAW_EXEC_MODE", "test");

/* ------------------------- provider registry ------------------------- */
// For official plugin providers (google-vertex, google, ollama...) we set the
// model ref and let the bundled plugin publish the catalog. We only add an
// explicit `models.providers.<id>` entry for custom/self-hosted endpoints
// that need a base URL or explicit adapter (e.g. host Ollama via Docker).
const isPluginManaged = (provider) =>
  ["google-vertex", "google", "openai", "anthropic", "ollama"].includes(
    provider,
  );

const buildProviders = () => {
  const out = {};
  const addProvider = (provider, name, baseUrl, apiKey, asFallback) => {
    if (isPluginManaged(provider)) {
      // Plugin-managed: only register an explicit entry when we must point
      // at a custom base URL (host Ollama reachable as host.docker.internal)
      // or when we need to pin provider-level timeouts. google-vertex gets an
      // entry purely to set a sane request timeout (the plugin supplies the
      // catalog and ADC auth).
      if (baseUrl || provider === "google-vertex") {
        const entry = {
          api: provider === "ollama" ? "openai-completions" : undefined,
          contextTokens,
          timeoutSeconds: requestTimeoutSec,
        };
        if (baseUrl) {
          entry.baseUrl = baseUrl;
          entry.apiKey = apiKey || undefined;
          entry.injectNumCtxForOpenAICompat = provider === "ollama";
          entry.models = [
            {
              id: name,
              name,
              contextWindow: contextTokens,
              maxTokens,
            },
          ];
        }
        out[provider] = entry;
      }
      return;
    }
    // Custom provider: explicit registry entry.
    out[provider] = {
      baseUrl: baseUrl || "http://host.docker.internal:11434/v1",
      apiKey: apiKey || "ollama",
      api: "openai-completions",
      contextTokens,
      injectNumCtxForOpenAICompat: true,
      timeoutSeconds: requestTimeoutSec,
      models: [
        {
          id: name,
          name,
          contextWindow: contextTokens,
          maxTokens,
        },
      ],
    };
  };

  // Primary model (default: google-vertex).
  if (modelProvider === "ollama") {
    addProvider(
      "ollama",
      modelName,
      modelBaseUrl || "http://host.docker.internal:11434/v1",
      modelApiKey || "ollama",
    );
  } else {
    addProvider(modelProvider, modelName, modelBaseUrl, modelApiKey);
  }
  // Fallback model (default: ollama via host.docker.internal).
  if (fallbackProvider && fallbackModel) {
    const fallbackNeedsEntry =
      fallbackProvider === "ollama" ||
      !isPluginManaged(fallbackProvider) ||
      fallbackProvider === "google-vertex";
    if (fallbackNeedsEntry && !(fallbackProvider in out)) {
      addProvider(
        fallbackProvider,
        fallbackModel,
        fallbackProvider === "ollama"
          ? fallbackBaseUrl || "http://host.docker.internal:11434/v1"
          : fallbackBaseUrl,
        fallbackApiKey ||
          (fallbackProvider === "ollama" ? "ollama" : undefined),
      );
    }
  }
  return out;
};
const providers = buildProviders();
const smallFallbackNeedsWebIsolation =
  fallbackProvider === "ollama" && /(?:0\.\d+|small|mini)/i.test(fallbackModel);

/* ------------------------- config assembly ------------------------- */

const authMode = gatewayToken ? "token" : "token";

const config = {
  $schema:
    "https://raw.githubusercontent.com/openclaw/openclaw/main/docs/reference/config-schema.json",
  // Engine identity is recorded in the .env next to the config so the
  // schema gate (which only tolerates $schema at root) stays clean.
  gateway: {
    mode: "local",
    bind: exposePublic ? "lan" : gatewayBind,
    port: gatewayPort,
    auth: { mode: authMode, token: gatewayToken },
    controlUi: { allowedOrigins: ["http://localhost", "http://127.0.0.1"] },
    trustedProxies: trustedProxies.length ? trustedProxies : undefined,
    allowRealIpFallback: false,
    reload: { mode: "hybrid" },
  },
  session: {
    dmScope,
    // Only include `reset` when the operator asked for one. The schema rejects
    // anything other than "daily" or "idle" so the default "none" must be
    // represented by omission.
    ...(resetMode === "none"
      ? {}
      : {
          reset: {
            mode: resetMode,
            atHour: resetAtHour,
            idleMinutes: resetIdleMinutes,
          },
        }),
  },
  agents: {
    defaults: {
      workspace: workspaceDir,
      model: {
        primary: `${modelProvider}/${modelName}`,
        fallbacks:
          fallbackProvider && fallbackModel
            ? [`${fallbackProvider}/${fallbackModel}`]
            : [],
      },
      models: {
        [`${modelProvider}/${modelName}`]: { alias: "primary" },
        ...(fallbackProvider && fallbackModel
          ? { [`${fallbackProvider}/${fallbackModel}`]: { alias: "fallback" } }
          : {}),
      },
      contextTokens,
      // Use OpenClaw's native transcript compaction for the engine session.
      // Departify's durable conversation summary remains the business source
      // of truth and is injected separately by the backend. Memory flush is
      // intentionally disabled here: the engine workspaces are shared by
      // agent identity, not physically partitioned per tenant, so writing
      // tenant facts to MEMORY.md would create a cross-tenant leak risk.
      contextInjection: "continuation-skip",
      compaction: {
        // OpenClaw v2026.7.1 enables native compaction by default; that
        // version rejects the newer `enabled` field in this object schema.
        mode: "safeguard",
        timeoutSeconds: compactionTimeoutSeconds,
        keepRecentTokens: compactionKeepRecentTokens,
        recentTurnsPreserve: compactionRecentTurns,
        identifierPolicy: "strict",
        qualityGuard: { enabled: true, maxRetries: 1 },
        midTurnPrecheck: { enabled: true },
        postIndexSync: "off",
        maxActiveTranscriptBytes: compactionMaxActiveTranscriptBytes,
        memoryFlush: { enabled: false },
      },
      thinkingDefault: "off",
      ...(founderParity ? {} : { skipBootstrap: true }),
      sandbox: enableSandbox
        ? { mode: "non-main", scope: "agent" }
        : { mode: "off" },
    },
    list: [
      {
        id: "main",
        default: true,
        workspace: join(workspaceDir, "agents", "main"),
      },
      {
        id: "agent_marketing_director",
        workspace: join(workspaceDir, "agents", "agent_marketing_director"),
      },
      {
        id: "agent_content_strategist",
        workspace: join(workspaceDir, "agents", "agent_content_strategist"),
      },
      {
        id: "agent_social_media_manager",
        workspace: join(workspaceDir, "agents", "agent_social_media_manager"),
      },
      {
        id: "agent_ads_specialist",
        workspace: join(workspaceDir, "agents", "agent_ads_specialist"),
      },
    ],
  },
  models: { providers },
  tools: founderParity
    ? {
        // Founder development follows OpenClaw's native capability surface.
        // Departify only adds its business tools; it does not rebuild or
        // narrow OpenClaw's own agentic runtime.
        profile: "full",
        ...(enableNativeBusinessTools
          ? {
              alsoAllow: [
                "departify.company.context",
                "departify.email.list",
                "departify.email.search",
                "departify.calendar.list",
                "departify.drive.search",
                "departify.drive.read",
                "departify.tasks.list",
                "departify.approvals.list",
                "departify.results.list",
                "departify.work.deliverable",
                "departify.marketing.delegate",
              ],
            }
          : {}),
        elevated: { enabled: true },
        exec: {
          host: "gateway",
          security: "full",
          ask: "off",
          timeoutSec: requestTimeoutSec,
        },
      }
    : {
        profile: "coding",
        alsoAllow: [
          ...(enableNativeBusinessTools
            ? [
                "departify.company.context",
                "departify.email.list",
                "departify.email.search",
                "departify.calendar.list",
                "departify.drive.search",
                "departify.drive.read",
                "departify.tasks.list",
                "departify.approvals.list",
                "departify.results.list",
                "departify.work.deliverable",
                "departify.marketing.delegate",
              ]
            : []),
          ...(execMode === "test" ? ["exec", "process", "read"] : []),
        ],
        ...(execMode === "test"
          ? {
              exec: {
                host: "gateway",
                security: "full",
                ask: "off",
                safeBinProfiles: {
                  date: {},
                  echo: {},
                  pwd: {},
                  env: {},
                  ls: {},
                  cat: {},
                  uname: {},
                },
                applyPatch: { enabled: false, workspaceOnly: true },
                timeoutSec: 30,
              },
            }
          : { exec: { security: "deny" } }),
        deny: [
          "gateway",
          "cron",
          "browser",
          "nodes",
          "write",
          "edit",
          "apply_patch",
          "exec",
          "process",
          "code_execution",
          "image",
          "image_generate",
          "music_generate",
          "video_generate",
          "tts",
        ],
        fs: { workspaceOnly: true },
        elevated: { enabled: false },
        ...(smallFallbackNeedsWebIsolation
          ? {
              byProvider: {
                [`${fallbackProvider}/${fallbackModel}`]: {
                  deny: ["group:web", "browser"],
                },
              },
            }
          : {}),
      },
  channels: {},
  ...(founderParity ? {} : { hooks: { enabled: false } }),
  discovery: {
    mdns: { mode: "off" },
  },
  plugins: founderParity
    ? {
        // Without an allowlist OpenClaw discovers its native plugin ecosystem.
        // The two explicit entries are Departify's integration surfaces.
        load: {
          paths: enableNativeBusinessTools ? ["/app/native-plugin"] : [],
        },
        ...(enableAdminHttpRpc || enableNativeBusinessTools
          ? {
              entries: {
                ...(enableAdminHttpRpc
                  ? { "admin-http-rpc": { enabled: true } }
                  : {}),
                ...(enableNativeBusinessTools
                  ? { "departify-native-tools": { enabled: true } }
                  : {}),
              },
            }
          : {}),
      }
    : {
        allow: [
          "codex",
          "diagnostics-otel",
          ...(enableNativeBusinessTools ? ["departify-native-tools"] : []),
          ...(enableAdminHttpRpc ? ["admin-http-rpc"] : []),
        ],
        load: {
          paths: enableNativeBusinessTools ? ["/app/native-plugin"] : [],
        },
        ...(enableAdminHttpRpc
          ? { entries: { "admin-http-rpc": { enabled: true } } }
          : {}),
        ...(enableNativeBusinessTools
          ? {
              entries: {
                ...(enableAdminHttpRpc
                  ? { "admin-http-rpc": { enabled: true } }
                  : {}),
                "departify-native-tools": { enabled: true },
              },
            }
          : {}),
      },
  logging: { level: logLevel },
};

/* drop undefined keys recursively so JSON output is clean */
const dropUndefined = (value) => {
  if (Array.isArray(value)) return value.map(dropUndefined);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = dropUndefined(v);
    }
    return out;
  }
  return value;
};
const cleaned = dropUndefined(config);

/* ------------------------- workspace bootstrap ------------------------- */

const agentWorkspace = join(workspaceDir, "agents", "main");
const writeSafely = async (path, body, mode) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body, { encoding: "utf8", mode });
};

await writeSafely(CONFIG_PATH, JSON.stringify(cleaned, null, 2) + "\n", 0o600);
await writeSafely(
  join(STATE_DIR, ".env"),
  [
    `OPENCLAW_GATEWAY_TOKEN=${gatewayToken}`,
    `OPENCLAW_STATE_DIR=${STATE_DIR}`,
    `OPENCLAW_CONFIG_PATH=${CONFIG_PATH}`,
    `OPENCLAW_CONFIG_DIR=${STATE_DIR}`,
    `OPENCLAW_WORKSPACE_DIR=${workspaceDir}`,
    `OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=${allowInsecurePrivateWs ? "1" : ""}`,
    `OPENCLAW_DISABLE_BONJOUR=${disableBonjour ? "1" : ""}`,
    `TZ=${optional("OPENCLAW_TZ", "UTC")}`,
  ].join("\n") + "\n",
  0o600,
);

// Engine identity sidecar (lives next to the config but outside the
// schema-gated `openclaw.json` so we can keep deployment metadata without
// tripping the "only $schema at root" rule).
await writeSafely(
  join(STATE_DIR, "engine.json"),
  JSON.stringify(
    {
      engineVersion,
      openclawVersion,
      openclawImage,
      runtimeMode,
      renderedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
  0o644,
);

if (!founderParity) {
  await writeSafely(
    join(workspaceDir, "AGENTS.md"),
    "# Departify Engine Workspace\n\nInternal workspace for the Departify engine. Not visible to the customer.\n",
    0o644,
  );
  await writeSafely(join(workspaceDir, "MEMORY.md"), "", 0o644);
  await writeSafely(
    join(workspaceDir, "IDENTITY.md"),
    "# Engine Identity\n\nEngine: Departify internal runtime (OpenClaw Gateway).\nNot customer-facing.\n",
    0o644,
  );
  await writeSafely(
    join(agentWorkspace, "AGENTS.md"),
    "# Agent: main\n\nDefault OpenClaw agent used by Departify tests and (later) the Engine Adapter.\n",
    0o644,
  );
  await writeSafely(join(agentWorkspace, "MEMORY.md"), "", 0o644);
  await writeSafely(
    join(agentWorkspace, "IDENTITY.md"),
    "# Agent Identity\n\nInternal. Not exposed to the Departify customer.\n",
    0o644,
  );
} else {
  await mkdir(agentWorkspace, { recursive: true });
}

// The CEO-facing agent and the three Marketing specialists are native
// OpenClaw agents. Their workspaces contain role instructions only; tenant
// business data and credentials are supplied by Departify at runtime.
const workforceInstructions = {
  main: "# Agent: main\n\nYou are the internal CEO-facing Departify agent. When the request is a Marketing business objective, coordinate with Elvira through Departify's native marketing delegation capability. Never expose internal agent ids or runtime details.\n",
  agent_marketing_director:
    "# Agent: agent_marketing_director\n\nYou are Elvira, Jefa de Marketing. Diagnose the CEO's objective, choose the right specialists, and synthesize their results. Use Departify's native delegation capability when a specialist is needed. Never expose internal runtime details.\n",
  agent_content_strategist:
    "# Agent: agent_content_strategist\n\nYou are the Marketing Content Specialist. Produce practical content strategy, copy, scripts, editorial calendars, and YouTube preparation. Return concise, actionable work to Elvira. Do not claim external publishing without an authorized connection.\n",
  agent_social_media_manager:
    "# Agent: agent_social_media_manager\n\nYou are the Marketing Social Media Specialist. Produce organic social strategy, channel adaptations, publishing plans, and Meta Business preparation. Separate recommendations from actions and never claim a post was published without authorization.\n",
  agent_ads_specialist:
    "# Agent: agent_ads_specialist\n\nYou are the Marketing Advertising Specialist. Produce paid acquisition strategy, campaign structure, audience hypotheses, creative requirements, and measurement plans. Treat spend and campaign mutations as approval-sensitive.\n",
};
for (const [agentId, instructions] of Object.entries(workforceInstructions)) {
  const workspace = join(workspaceDir, "agents", agentId);
  await mkdir(workspace, { recursive: true });
  await writeSafely(join(workspace, "AGENTS.md"), instructions, 0o644);
  await writeSafely(join(workspace, "MEMORY.md"), "", 0o644);
  await writeSafely(
    join(workspace, "IDENTITY.md"),
    `# ${agentId}\n\nInternal Departify workforce identity. Not customer-facing.\n`,
    0o644,
  );
}

const finalStat = await stat(CONFIG_PATH);
console.log(
  `[render-config] wrote ${CONFIG_PATH} (${finalStat.size} bytes), engine=${engineVersion}, openclaw=${openclawVersion}`,
);

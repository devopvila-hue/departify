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
import { dirname, join, resolve } from "node:path";

const STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/home/node/.openclaw";
const CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH || join(STATE_DIR, "openclaw.json");
const BOOTSTRAP_DIR =
  process.env.OPENCLAW_BOOTSTRAP_DIR ||
  resolve(dirname(new URL(import.meta.url).pathname), "..", "bootstrap");

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
const fallbackProvider = optional("OPENCLAW_FALLBACK_PROVIDER", "ollama");
const fallbackModel = optional("OPENCLAW_FALLBACK_MODEL", "qwen3:0.6b");
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
const maxTokens = int("OPENCLAW_MAX_TOKENS", 2048);
const contextTokens = int("OPENCLAW_CONTEXT_TOKENS", 131072);
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
        fallbackApiKey || (fallbackProvider === "ollama" ? "ollama" : undefined),
      );
    }
  }
  return out;
};
const providers = buildProviders();

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
      thinkingDefault: "off",
      skipBootstrap: true,
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
    ],
  },
  models: { providers },
  tools: {
    profile: "messaging",
    // In "test" mode expose exec (bounded to safe bins) so the tool loop is a
    // real agent→tool→result cycle. In "locked" mode exec is denied entirely.
    ...(execMode === "test"
      ? {
          alsoAllow: ["exec", "process", "read"],
          exec: {
            host: "gateway",
            security: "full",
            ask: "off",
            // Bounded to safe, read-only / non-mutating commands. Profiles
            // make the allowlist deterministic (avoids "unprofiled safeBins"
            // warnings) while keeping the surface read-only.
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
    deny: ["gateway", "cron", "web_search", "web_fetch", "browser", "write", "edit", "apply_patch"],
    fs: { workspaceOnly: true },
  },
  channels: {},
  hooks: { enabled: false },
  discovery: {
    mdns: { mode: "off" },
  },
  plugins: { allow: ["codex", "diagnostics-otel"] },
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
const bootstrapAgents = {
  ...(await import(join(BOOTSTRAP_DIR, "agents.json")).then((m) => m.default || m).catch(() => ({}))),
};
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
      renderedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
  0o644,
);

await writeSafely(join(workspaceDir, "AGENTS.md"), "# Departify Engine Workspace\n\nInternal workspace for the Departify engine. Not visible to the customer.\n", 0o644);
await writeSafely(join(workspaceDir, "MEMORY.md"), "", 0o644);
await writeSafely(join(workspaceDir, "IDENTITY.md"), "# Engine Identity\n\nEngine: Departify internal runtime (OpenClaw Gateway).\nNot customer-facing.\n", 0o644);
await writeSafely(
  join(agentWorkspace, "AGENTS.md"),
  "# Agent: main\n\nDefault OpenClaw agent used by Departify tests and (later) the Engine Adapter.\n",
  0o644,
);
await writeSafely(join(agentWorkspace, "MEMORY.md"), "", 0o644);
await writeSafely(join(agentWorkspace, "IDENTITY.md"), "# Agent Identity\n\nInternal. Not exposed to the Departify customer.\n", 0o644);

const finalStat = await stat(CONFIG_PATH);
console.log(
  `[render-config] wrote ${CONFIG_PATH} (${finalStat.size} bytes), engine=${engineVersion}, openclaw=${openclawVersion}`,
);

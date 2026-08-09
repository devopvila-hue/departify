import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const optionalSecret = z.string().min(1).optional().or(z.literal(""));

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3210),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: optionalSecret,
  SUPABASE_SECRET_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  DATABASE_URL: optionalSecret,

  RAILWAY_ENVIRONMENT: z.string().optional().or(z.literal("")),
  RAILWAY_PROJECT_ID: z.string().optional().or(z.literal("")),
  RAILWAY_SERVICE_ID: z.string().optional().or(z.literal("")),
  RAILWAY_HEALTHCHECK_TIMEOUT_SEC: z.coerce
    .number()
    .int()
    .positive()
    .optional(),

  /** Public base URL of the portal (OAuth redirects + links). */
  PUBLIC_BASE_URL: optionalUrl,
  /** Comma-separated allowed browser origins for CORS. Empty = same-origin. */
  CORS_ALLOWED_ORIGINS: z.string().optional().or(z.literal("")),

  NETLIFY_SITE_ID: z.string().optional().or(z.literal("")),
  NETLIFY_AUTH_TOKEN: optionalSecret,

  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  /** Optional base URL for OpenAI-compatible endpoints (e.g. a local gateway). */
  OPENAI_BASE_URL: optionalUrl,

  GOOGLE_VERTEX_PROJECT_ID: z.string().optional().or(z.literal("")),
  GOOGLE_VERTEX_LOCATION: z.string().optional().or(z.literal("")),
  GOOGLE_VERTEX_MODEL: z.string().optional().or(z.literal("")),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional().or(z.literal("")),

  MINIMAX_API_KEY: optionalSecret,
  MINIMAX_BASE_URL: optionalUrl,
  MINIMAX_MODEL: z.string().optional().or(z.literal("")),

  LLM_DEFAULT_PROVIDER: z
    .enum(["openai", "google_vertex", "minimax"])
    .default("openai"),
  LLM_ROUTING_STRATEGY: z
    .enum(["capability_first", "balanced"])
    .default("capability_first"),
  ANTHROPIC_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  OLLAMA_HOST: optionalUrl,

  JWT_SECRET: optionalSecret,
  JWT_ISSUER: z.string().optional().or(z.literal("")),
  JWT_AUDIENCE: z.string().optional().or(z.literal("")),

  OTEL_SERVICE_NAME: z.string().default("departify-backend"),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  METRICS_ENABLED: z.coerce.boolean().default(false),
  TRACING_ENABLED: z.coerce.boolean().default(false),

  // ── Engine Adapter (Sprint ENGINE 02) ──
  ENGINE_PROVIDER: z.enum(["openclaw"]).default("openclaw"),
  // Production runtime policy: "strict" fails clearly when the engine is
  // unavailable (no silent legacy fallback); "legacy-fallback" keeps the old
  // path for dev/test only.
  ENGINE_RUNTIME_POLICY: z
    .enum(["strict", "legacy-fallback"])
    .default("strict"),
  OPENCLAW_GATEWAY_URL: z.string().optional().or(z.literal("")),
  OPENCLAW_GATEWAY_TOKEN: optionalSecret,
  OPENCLAW_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(120_000),
  OPENCLAW_CONNECT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15_000),
  OPENCLAW_RETRY_LIMIT: z.coerce.number().int().min(0).default(2),
  OPENCLAW_MAX_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(8_000),
  /** Optional path to a persisted Ed25519 PEM key for gateway device auth. */
  OPENCLAW_DEVICE_KEY_PATH: z.string().optional().or(z.literal("")),
  /** Optional inline Ed25519 PEM key (secret-injected). Takes precedence over
   * OPENCLAW_DEVICE_KEY_PATH when both are present. */
  OPENCLAW_DEVICE_KEY_PEM: z.string().optional().or(z.literal("")),
  /** Optional model override sent with every message (provider/model). */
  OPENCLAW_MODEL: z.string().optional().or(z.literal("")),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(
  input: Record<string, string | undefined>,
): EnvConfig {
  return envSchema.parse(input);
}

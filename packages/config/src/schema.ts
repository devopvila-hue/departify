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

  NETLIFY_SITE_ID: z.string().optional().or(z.literal("")),
  NETLIFY_AUTH_TOKEN: optionalSecret,

  OPENAI_API_KEY: optionalSecret,
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  LLM_DEFAULT_PROVIDER: z.string().min(2).default("openai"),
  LLM_ROUTING_STRATEGY: z
    .enum(["capability_first", "balanced"])
    .default("capability_first"),
  ANTHROPIC_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  MINIMAX_API_KEY: optionalSecret,
  OLLAMA_HOST: optionalUrl,

  JWT_SECRET: optionalSecret,
  JWT_ISSUER: z.string().optional().or(z.literal("")),
  JWT_AUDIENCE: z.string().optional().or(z.literal("")),

  OTEL_SERVICE_NAME: z.string().default("departify-backend"),
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  METRICS_ENABLED: z.coerce.boolean().default(false),
  TRACING_ENABLED: z.coerce.boolean().default(false),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(
  input: Record<string, string | undefined>,
): EnvConfig {
  return envSchema.parse(input);
}

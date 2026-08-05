import { envSchema } from "./schema.js";

export type RuntimeEnvironment = "development" | "test" | "production";

export interface BackendConfig {
  environment: RuntimeEnvironment;
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  name: string;
  version: string;
  observability: {
    serviceName: string;
    metricsEnabled: boolean;
    tracingEnabled: boolean;
    otlpEndpoint?: string;
  };
  providers: {
    supabaseUrl?: string;
    ollamaHost?: string;
  };
}

export const backendConfigSchema = envSchema.transform((env): BackendConfig => {
  const otlpEndpoint = normalizeOptional(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const supabaseUrl = normalizeOptional(env.SUPABASE_URL);
  const ollamaHost = normalizeOptional(env.OLLAMA_HOST);

  return {
    environment: env.NODE_ENV,
    host: env.HOST,
    port: env.PORT,
    logLevel:
      env.NODE_ENV === "test" && env.LOG_LEVEL === "info"
        ? "silent"
        : env.LOG_LEVEL,
    name: "@departify/backend",
    version: "0.0.0",
    observability: {
      serviceName: env.OTEL_SERVICE_NAME,
      metricsEnabled: env.METRICS_ENABLED,
      tracingEnabled: env.TRACING_ENABLED,
      ...(otlpEndpoint ? { otlpEndpoint } : {}),
    },
    providers: {
      ...(supabaseUrl ? { supabaseUrl } : {}),
      ...(ollamaHost ? { ollamaHost } : {}),
    },
  };
});

export function loadBackendConfig(): BackendConfig {
  return backendConfigSchema.parse(process.env);
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

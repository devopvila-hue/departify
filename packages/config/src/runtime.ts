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

export interface OpenAIProviderConfig {
  apiKey: string;
  defaultModel: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface GoogleVertexProviderConfig {
  projectId: string;
  location: string;
  defaultModel: string;
  applicationCredentials?: string;
}

export interface MiniMaxProviderConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
}

export type LlmDefaultProvider = "openai" | "google_vertex" | "minimax";

export type LlmRoutingStrategy = "capability_first" | "balanced";

export interface LlmRouterConfig {
  defaultProvider: LlmDefaultProvider;
  defaultStrategy: LlmRoutingStrategy;
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

export const openAIProviderConfigSchema = envSchema.transform(
  (env): OpenAIProviderConfig => {
    const apiKey = normalizeOptional(env.OPENAI_API_KEY);
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for the OpenAI provider.");
    }
    return {
      apiKey,
      defaultModel: env.OPENAI_MODEL,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      maxRetries: env.OPENAI_MAX_RETRIES,
    };
  },
);

export function loadOpenAIProviderConfig(): OpenAIProviderConfig {
  return openAIProviderConfigSchema.parse(process.env);
}

export const googleVertexProviderConfigSchema = envSchema.transform(
  (env): GoogleVertexProviderConfig => {
    const projectId = normalizeOptional(env.GOOGLE_VERTEX_PROJECT_ID);
    const location = normalizeOptional(env.GOOGLE_VERTEX_LOCATION);
    const defaultModel = normalizeOptional(env.GOOGLE_VERTEX_MODEL);
    const applicationCredentials = normalizeOptional(
      env.GOOGLE_APPLICATION_CREDENTIALS,
    );
    if (!projectId) {
      throw new Error(
        "GOOGLE_VERTEX_PROJECT_ID is required for the Google Vertex provider.",
      );
    }
    if (!location) {
      throw new Error(
        "GOOGLE_VERTEX_LOCATION is required for the Google Vertex provider.",
      );
    }
    if (!defaultModel) {
      throw new Error(
        "GOOGLE_VERTEX_MODEL is required for the Google Vertex provider.",
      );
    }
    return {
      projectId,
      location,
      defaultModel,
      ...(applicationCredentials ? { applicationCredentials } : {}),
    };
  },
);

export function loadGoogleVertexProviderConfig(): GoogleVertexProviderConfig {
  return googleVertexProviderConfigSchema.parse(process.env);
}

export const miniMaxProviderConfigSchema = envSchema.transform(
  (env): MiniMaxProviderConfig => {
    const apiKey = normalizeOptional(env.MINIMAX_API_KEY);
    const baseUrl = normalizeOptional(env.MINIMAX_BASE_URL);
    const defaultModel = normalizeOptional(env.MINIMAX_MODEL);
    if (!apiKey) {
      throw new Error("MINIMAX_API_KEY is required for the MiniMax provider.");
    }
    if (!baseUrl) {
      throw new Error("MINIMAX_BASE_URL is required for the MiniMax provider.");
    }
    if (!defaultModel) {
      throw new Error("MINIMAX_MODEL is required for the MiniMax provider.");
    }
    return { apiKey, baseUrl, defaultModel };
  },
);

export function loadMiniMaxProviderConfig(): MiniMaxProviderConfig {
  return miniMaxProviderConfigSchema.parse(process.env);
}

export const llmRouterConfigSchema = envSchema.transform(
  (env): LlmRouterConfig => ({
    defaultProvider: env.LLM_DEFAULT_PROVIDER,
    defaultStrategy: env.LLM_ROUTING_STRATEGY,
  }),
);

export function loadLlmRouterConfig(): LlmRouterConfig {
  return llmRouterConfigSchema.parse(process.env);
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * BYOK provider registry — the SINGLE source of truth for which LLM providers
 * and models the CEO can select on /configuracion.
 *
 * Contract:
 *
 *   ByokProviderDescriptor {
 *     id
 *     label
 *     enabled              — true only when a real adapter + validation +
 *                             secure storage exists for this provider
 *     credentialType       — "api_key" today; future may add oauth, etc.
 *     requiresBaseUrl      — true for OpenAI-compatible endpoints that
 *                             expose a different host (e.g. MiniMax)
 *     apiKeyPlaceholder    — short hint shown in the portal input
 *     documentationUrl     — official docs (English)
 *     apiKeyUrl            — official "create a key" page
 *     models[]             — only models that the current adapter can call
 *   }
 *
 * The portal never hardcodes providers/models. It calls
 * `listByokProviderDescriptors()` server-side; the frontend renders the
 * result. A provider is `enabled` only when four conditions hold:
 *
 *   1. a real adapter/router is installed and exported as a package;
 *   2. a real probe exists that validates an API key against the provider;
 *   3. the credential vault stores the secret server-side and never returns
 *      it to the portal;
 *   4. the runtime can execute the selected model end-to-end.
 *
 * If any of those four is missing, the provider is intentionally hidden —
 * it is far worse to show a control that fails than to show one less card.
 *
 * Today:
 *   - openai    — REAL (OpenAI SDK, OpenAI-compatible base URL supported).
 *   - minimax   — REAL (MiniMax exposes an OpenAI-compatible
 *                 /v1/chat/completions endpoint; we instantiate the OpenAI
 *                 SDK with that base URL and the BYOK key, same shape as
 *                 openai).
 *   - google_vertex, anthropic, gemini — NOT INCLUDED. They would require
 *                 redesigning the runtime (Vertex = service-account JSON,
 *                 not API-key BYOK; Anthropic/Gemini = no adapter shipped).
 *                 They will appear in this registry ONLY when those four
 *                 conditions become true. See sprint planning.
 */

export type ByokProviderId = "openai" | "minimax";

export type ByokCredentialType = "api_key";

export interface ByokModelDescriptor {
  readonly id: string;
  readonly label: string;
  readonly recommended: boolean;
  readonly enabled: boolean;
}

export interface ByokProviderDescriptor {
  readonly id: ByokProviderId;
  readonly label: string;
  readonly enabled: boolean;
  readonly credentialType: ByokCredentialType;
  readonly requiresBaseUrl: boolean;
  readonly apiKeyPlaceholder: string;
  readonly documentationUrl: string;
  readonly apiKeyUrl: string;
  readonly models: readonly ByokModelDescriptor[];
}

const OPENAI_MODELS: readonly ByokModelDescriptor[] = [
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini — recomendado",
    recommended: true,
    enabled: true,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    recommended: false,
    enabled: true,
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    recommended: false,
    enabled: true,
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    recommended: false,
    enabled: true,
  },
  {
    id: "o4-mini",
    label: "o4-mini (razonamiento)",
    recommended: false,
    enabled: true,
  },
];

const MINIMAX_MODELS: readonly ByokModelDescriptor[] = [
  {
    id: "MiniMax-M3",
    label: "MiniMax M3 — recomendado",
    recommended: true,
    enabled: true,
  },
  {
    id: "MiniMax-M2",
    label: "MiniMax M2",
    recommended: false,
    enabled: true,
  },
];

/**
 * Default base URL exposed by the MiniMax inference gateway. May be
 * overridden per organization; tenant-side `baseUrl` is what makes this
 * BYOK-safe (a tenant can point at any compatible endpoint).
 */
export const MINIMAX_DEFAULT_BASE_URL =
  (process.env["MINIMAX_BASE_URL"] ?? "").trim() ||
  "https://api.MiniMax.com/v1";

const PROVIDERS: readonly ByokProviderDescriptor[] = [
  {
    id: "openai",
    label: "OpenAI",
    enabled: true,
    credentialType: "api_key",
    requiresBaseUrl: false,
    apiKeyPlaceholder: "sk-…",
    documentationUrl:
      "https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    models: OPENAI_MODELS,
  },
  {
    id: "minimax",
    label: "MiniMax",
    enabled: true,
    credentialType: "api_key",
    requiresBaseUrl: true,
    apiKeyPlaceholder: "sk-… (clave del proveedor)",
    documentationUrl: "https://platform.MiniMax.com/docs/quickstart",
    apiKeyUrl: "https://platform.MiniMax.com/user-center/apikeys",
    models: MINIMAX_MODELS,
  },
];

export function listByokProviderDescriptors(): readonly ByokProviderDescriptor[] {
  return PROVIDERS;
}

export function getByokProviderDescriptor(
  providerId: string,
): ByokProviderDescriptor | null {
  return PROVIDERS.find((p) => p.id === providerId) ?? null;
}

export function isKnownByokProvider(providerId: string): providerId is ByokProviderId {
  return providerId === "openai" || providerId === "minimax";
}

export function getByokModelDescriptor(
  providerId: ByokProviderId,
  modelId: string,
): ByokModelDescriptor | null {
  const provider = getByokProviderDescriptor(providerId);
  if (!provider) return null;
  return provider.models.find((m) => m.id === modelId) ?? null;
}

export interface ByokValidationInput {
  readonly providerId: ByokProviderId;
  readonly modelId: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
}

export interface ByokValidationSuccess {
  readonly valid: true;
  readonly providerId: ByokProviderId;
  readonly modelId: string;
}

export interface ByokValidationFailure {
  readonly valid: false;
  readonly code:
    | "invalid_api_key"
    | "provider_unavailable"
    | "unsupported_model";
  readonly message: string;
}

export type ByokValidationResult =
  | ByokValidationSuccess
  | ByokValidationFailure;

/**
 * Real probe — calls the provider's cheapest operational endpoint with a
 * 10-second timeout. Translates network/auth failures into the same
 * human-readable Spanish strings used elsewhere in /configuracion.
 */
export async function validateByokCredential(
  input: ByokValidationInput,
): Promise<ByokValidationResult> {
  const descriptor = getByokProviderDescriptor(input.providerId);
  if (!descriptor) {
    return {
      valid: false,
      code: "unsupported_model",
      message: "Este proveedor todavía no está disponible.",
    };
  }
  if (!getByokModelDescriptor(input.providerId, input.modelId)) {
    return {
      valid: false,
      code: "unsupported_model",
      message: "Selecciona un modelo compatible con este proveedor.",
    };
  }
  if (input.providerId === "openai") {
    return validateOpenAiCompatible({
      apiKey: input.apiKey,
      baseUrl: input.baseUrl ?? "https://api.openai.com/v1",
      modelId: input.modelId,
      probeEndpoint: "models",
      providerLabel: "OpenAI",
    });
  }
  return validateOpenAiCompatible({
    apiKey: input.apiKey,
    baseUrl: (input.baseUrl ?? MINIMAX_DEFAULT_BASE_URL).trim(),
    modelId: input.modelId,
    probeEndpoint: "chat_probe",
    providerLabel: "MiniMax",
  });
}

async function validateOpenAiCompatible(options: {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  probeEndpoint: "models" | "chat_probe";
  providerLabel: string;
}): Promise<ByokValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    if (options.probeEndpoint === "models") {
      const response = await fetch(new URL("/models", options.baseUrl).toString(), {
        headers: { Authorization: `Bearer ${options.apiKey}` },
        signal: controller.signal,
      });
      if (response.ok) return { valid: true, providerId: "openai", modelId: options.modelId };
      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          code: "invalid_api_key",
          message:
            "Esta clave no es válida. Comprueba que la has copiado completa y vuelve a intentarlo.",
        };
      }
      return {
        valid: false,
        code: "provider_unavailable",
        message: `${options.providerLabel} no está disponible ahora mismo. Inténtalo de nuevo en unos minutos.`,
      };
    }
    // chat_probe — minimal /v1/chat/completions with a single-token cap so
    // it costs effectively nothing and never produces user-visible output.
    const response = await fetch(new URL("/chat/completions", options.baseUrl).toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: options.modelId,
        messages: [{ role: "user", content: "." }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    if (response.ok) return { valid: true, providerId: "minimax", modelId: options.modelId };
    if (response.status === 401 || response.status === 403) {
      return {
        valid: false,
        code: "invalid_api_key",
        message:
          "Esta clave no es válida. Comprueba que la has copiado completa y vuelve a intentarlo.",
      };
    }
    if (response.status === 404 || response.status === 400) {
      // 400/404 on a token probe commonly means "model not found for this
      // account". Surface the same "invalid key for this model" copy the
      // portal already uses for OpenAI; do not leak upstream details.
      return {
        valid: false,
        code: "invalid_api_key",
        message:
          "Esta clave no tiene acceso al modelo seleccionado. Comprueba el identificador del modelo o usa uno recomendado.",
      };
    }
    return {
      valid: false,
      code: "provider_unavailable",
      message: `${options.providerLabel} no está disponible ahora mismo. Inténtalo de nuevo en unos minutos.`,
    };
  } catch {
    return {
      valid: false,
      code: "provider_unavailable",
      message: `No hemos podido comprobar la clave ahora mismo. Inténtalo de nuevo en unos minutos.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

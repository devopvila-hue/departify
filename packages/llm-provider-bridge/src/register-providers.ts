import type { ProviderRegistry } from "@departify/llm-router";
import { registerGoogleVertexProvider } from "@departify/llm-provider-google";
import { registerMiniMaxProvider } from "@departify/llm-provider-minimax";
import { registerOpenAIProvider } from "@departify/llm-provider-openai";

/**
 * Provider registration outcome. The bridge records the outcome of every
 * attempted registration so the host application can decide whether missing
 * credentials should fail the bootstrap or just skip that provider.
 */
export interface ProviderRegistrationOutcome {
  providerId: string;
  registered: boolean;
  error?: string;
}

/**
 * Optional callbacks invoked while the bridge attempts to register each
 * provider. They let the host log progress without coupling the bridge to a
 * concrete logger.
 */
export interface ProviderRegistrationObservers {
  onAttempt?(providerId: string): void;
  onRegistered?(providerId: string): void;
  onSkipped?(providerId: string, reason: string): void;
}

export interface RegisterAllProvidersOptions {
  observers?: ProviderRegistrationObservers;
  /**
   * When true (default), missing credentials cause the bridge to silently
   * skip the provider. When false, missing credentials are re-thrown so the
   * host can decide whether to fail fast.
   */
  skipMissingCredentials?: boolean;
}

interface ProviderRegistrationStep {
  providerId: string;
  register: (registry: ProviderRegistry) => unknown;
}

/**
 * Provider registration pipeline.
 *
 * The bridge treats every provider identically: it calls the provider's own
 * `registerXProvider(registry)` helper and reports the outcome. The provider
 * ids are declared once here and never duplicated elsewhere.
 */
export const PROVIDER_REGISTRATION_PIPELINE: readonly ProviderRegistrationStep[] =
  [
    { providerId: "openai", register: registerOpenAIProvider },
    { providerId: "google_vertex", register: registerGoogleVertexProvider },
    { providerId: "minimax", register: registerMiniMaxProvider },
  ];

/**
 * Registers every provider that can boot from its current configuration.
 *
 * The bridge delegates provider-specific knowledge to each adapter. It never
 * inspects provider SDKs, configuration values, or any concrete model. The
 * only shared contract is the `registerXProvider(registry)` function shape
 * and the provider id it maps to.
 */
export function registerAllProviders(
  registry: ProviderRegistry,
  options: RegisterAllProvidersOptions = {},
): readonly ProviderRegistrationOutcome[] {
  const skipMissing = options.skipMissingCredentials ?? true;
  const outcomes: ProviderRegistrationOutcome[] = [];

  for (const step of PROVIDER_REGISTRATION_PIPELINE) {
    options.observers?.onAttempt?.(step.providerId);
    try {
      step.register(registry);
      options.observers?.onRegistered?.(step.providerId);
      outcomes.push({ providerId: step.providerId, registered: true });
    } catch (cause) {
      const reason = errorMessage(cause);
      if (!skipMissing) {
        throw cause;
      }
      options.observers?.onSkipped?.(step.providerId, reason);
      outcomes.push({
        providerId: step.providerId,
        registered: false,
        error: reason,
      });
    }
  }

  return outcomes;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return "Unknown provider registration error.";
}

import type {
  LlmProvider,
  LlmProviderDescriptor,
} from "../contracts/provider-contracts.js";
import type { LlmModelDescriptor } from "../models/model-catalog.js";
import { assertRouterValid } from "../validation/router-error.js";

/**
 * Provider Registry is the internal authoritative source for provider lookup.
 *
 * It is intentionally simple: explicit registration, explicit selection.
 * Discovery is out of scope for Sprint 18.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, LlmProvider>();

  register(provider: LlmProvider): void {
    const descriptor = provider.describe();
    validateProviderDescriptor(descriptor);
    this.assertProviderIdUnique(descriptor.providerId);
    this.providers.set(descriptor.providerId, provider);
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  get(providerId: string): LlmProvider {
    assertRouterValid(
      this.providers.has(providerId),
      `Provider '${providerId}' is not registered.`,
    );
    return this.providers.get(providerId) as LlmProvider;
  }

  tryGet(providerId: string): LlmProvider | null {
    return this.providers.get(providerId) ?? null;
  }

  list(): readonly LlmProvider[] {
    return [...this.providers.values()];
  }

  listDescriptors(): readonly LlmProviderDescriptor[] {
    return [...this.providers.values()].map((provider) => provider.describe());
  }

  /**
   * A provider is considered available when it has been registered and exposes
   * at least one model descriptor. Provider-specific liveness remains the
   * provider's responsibility.
   */
  isAvailable(providerId: string): boolean {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return false;
    }
    return provider.describe().models.length > 0;
  }

  selectProvider(preferredId?: string): LlmProvider {
    if (preferredId) {
      return this.get(preferredId);
    }
    assertRouterValid(
      this.providers.size > 0,
      "No provider is registered with the LLM Router.",
    );
    const first = this.providers.values().next().value as LlmProvider;
    return first;
  }

  collectModels(): readonly LlmModelDescriptor[] {
    const models: LlmModelDescriptor[] = [];
    for (const provider of this.providers.values()) {
      models.push(...provider.describe().models);
    }
    return models;
  }

  private assertProviderIdUnique(providerId: string): void {
    assertRouterValid(
      !this.providers.has(providerId),
      `Provider '${providerId}' is already registered.`,
    );
  }
}

function validateProviderDescriptor(descriptor: LlmProviderDescriptor): void {
  assertRouterValid(
    descriptor.providerId.trim().length >= 2,
    "Provider id is required for registration.",
  );
  assertRouterValid(
    descriptor.displayName.trim().length >= 2,
    "Provider displayName is required for registration.",
  );
  assertRouterValid(
    descriptor.models.length > 0,
    "Provider must expose at least one model descriptor.",
  );
}

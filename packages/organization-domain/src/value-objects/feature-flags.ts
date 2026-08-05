import { assertDomainInvariant } from "../validation/domain-error.js";

const featureFlagKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

export type FeatureFlagsSnapshot = Readonly<Record<string, boolean>>;

export class FeatureFlags {
  private constructor(private readonly values: FeatureFlagsSnapshot) {}

  static create(values: Record<string, boolean> = {}): FeatureFlags {
    const entries = Object.entries(values);

    for (const [key, enabled] of entries) {
      assertDomainInvariant(
        featureFlagKeyPattern.test(key),
        "Feature flag keys must be lowercase safe identifiers.",
      );
      assertDomainInvariant(
        typeof enabled === "boolean",
        "Feature flag values must be boolean.",
      );
    }

    return new FeatureFlags(Object.freeze({ ...values }));
  }

  isEnabled(key: string): boolean {
    return this.values[key] ?? false;
  }

  toSnapshot(): FeatureFlagsSnapshot {
    return { ...this.values };
  }
}

import type { ProviderRegistry } from "@departify/llm-router";
import { ProviderRegistry as ProviderRegistryImpl } from "@departify/llm-router";
import {
  PROVIDER_REGISTRATION_PIPELINE,
  registerAllProviders,
} from "../../src/index.js";

describe("registerAllProviders", () => {
  it("exposes a stable pipeline with three provider steps", () => {
    expect(PROVIDER_REGISTRATION_PIPELINE).toHaveLength(3);
    expect(
      PROVIDER_REGISTRATION_PIPELINE.map((step) => step.providerId),
    ).toEqual(["openai", "google_vertex", "minimax"]);
  });

  it("returns one outcome per pipeline step", () => {
    const registry = new ProviderRegistryImpl();
    const outcomes = registerAllProviders(registry);
    expect(outcomes).toHaveLength(PROVIDER_REGISTRATION_PIPELINE.length);
  });

  it("skips providers whose configuration is unavailable when skipMissingCredentials is true", () => {
    const registry = new ProviderRegistryImpl();
    const outcomes = registerAllProviders(registry);
    const skipped = outcomes.filter((o) => !o.registered);

    // Without credentials the three providers must skip gracefully without
    // throwing; the bridge is provider-agnostic so it never inspects env vars.
    expect(skipped.length).toBeGreaterThan(0);
    expect(outcomes.some((o) => o.providerId === "openai")).toBe(true);
    expect(outcomes.some((o) => o.providerId === "google_vertex")).toBe(true);
    expect(outcomes.some((o) => o.providerId === "minimax")).toBe(true);
  });

  it("rethrows when skipMissingCredentials is false and credentials are missing", () => {
    const registry = new ProviderRegistryImpl();
    expect(() =>
      registerAllProviders(registry, { skipMissingCredentials: false }),
    ).toThrow();
  });

  it("invokes observer callbacks on attempt, registered and skipped", () => {
    const registry = new ProviderRegistryImpl();
    const attempts: string[] = [];
    const registered: string[] = [];
    const skipped: string[] = [];

    registerAllProviders(registry, {
      observers: {
        onAttempt(providerId) {
          attempts.push(providerId);
        },
        onRegistered(providerId) {
          registered.push(providerId);
        },
        onSkipped(providerId) {
          skipped.push(providerId);
        },
      },
    });

    expect(attempts).toEqual(["openai", "google_vertex", "minimax"]);
    expect(registered.length + skipped.length).toBe(3);
  });

  it("registers providers whose configuration is present", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    process.env.OPENAI_TIMEOUT_MS = "1000";
    process.env.OPENAI_MAX_RETRIES = "1";
    process.env.GOOGLE_VERTEX_PROJECT_ID = "my-project";
    process.env.GOOGLE_VERTEX_LOCATION = "us-central1";
    process.env.GOOGLE_VERTEX_MODEL = "gemini-1.5-pro";
    process.env.MINIMAX_API_KEY = "minimax-key";
    process.env.MINIMAX_BASE_URL = "https://api.minimax.example.com/v1";
    process.env.MINIMAX_MODEL = "minimax-1";

    const registry: ProviderRegistry = new ProviderRegistryImpl();
    const outcomes = registerAllProviders(registry);
    const registered = outcomes.filter((o) => o.registered);

    expect(registered.map((o) => o.providerId).sort()).toEqual(
      ["google_vertex", "minimax", "openai"].sort(),
    );
    expect(
      registry
        .listDescriptors()
        .map((d) => d.providerId)
        .sort(),
    ).toEqual(["google_vertex", "minimax", "openai"].sort());
  });
});

import {
  createGoogleVertexProviderRuntimeConfig,
  GoogleVertexProviderValidationError,
} from "../../src/index.js";

describe("Google Vertex provider configuration", () => {
  it("creates a typed runtime config from packages/config", () => {
    const runtime = createGoogleVertexProviderRuntimeConfig({
      projectId: "my-project",
      location: "us-central1",
      defaultModel: "gemini-1.5-pro",
      applicationCredentials: "/tmp/credentials.json",
    });

    expect(runtime).toMatchObject({
      projectId: "my-project",
      location: "us-central1",
      defaultModel: "gemini-1.5-pro",
      applicationCredentials: "/tmp/credentials.json",
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  });

  it("omits applicationCredentials when not supplied", () => {
    const runtime = createGoogleVertexProviderRuntimeConfig({
      projectId: "my-project",
      location: "us-central1",
      defaultModel: "gemini-1.5-pro",
    });

    expect(runtime.applicationCredentials).toBeUndefined();
  });

  it("rejects missing fields", () => {
    expect(() =>
      createGoogleVertexProviderRuntimeConfig({
        projectId: "",
        location: "us-central1",
        defaultModel: "gemini-1.5-pro",
      }),
    ).toThrow(GoogleVertexProviderValidationError);
  });
});

import { describe, expect, it } from "vitest";
import { GoogleAdsApiRuntime } from "../src/index.js";

const request = {
  requestId: "google-write-1",
  organizationId: "org-a",
  capability: "marketing.google.ads.manage",
  operation: "execute" as const,
  input: { mutateOperations: [{ campaignBudgetOperation: { update: { resourceName: "customers/123/campaignBudgets/1" } } }] },
  sideEffect: true,
};

describe("GoogleAdsApiRuntime", () => {
  it("uses secure account/token closures and normalizes an API success", async () => {
    let received: RequestInit | undefined;
    const runtime = new GoogleAdsApiRuntime({
      accessToken: () => "access-secret",
      developerToken: () => "developer-secret",
      customerId: () => "1234567890",
      loginCustomerId: () => "098-765-4321",
      fetch: async (url, init) => {
        received = init;
        expect(url).toContain("/v25/customers/1234567890:mutate");
        return new Response(JSON.stringify({ results: [{ resourceName: "customers/123/campaigns/9" }] }), { status: 200 });
      },
    });
    const result = await runtime.execute(request);
    expect(result).toMatchObject({ provider: "google_ads_api", status: "succeeded", output: { results: [{ resourceName: "customers/123/campaigns/9" }] } });
    expect((received?.headers as Record<string, string>)["developer-token"]).toBe("developer-secret");
    expect(String(received?.body)).not.toContain("access-secret");
    expect(String(received?.body)).not.toContain("developer-secret");
  });

  it("never accepts account overrides and requires a real write payload", async () => {
    const runtime = new GoogleAdsApiRuntime({ accessToken: () => "a", developerToken: () => "d", customerId: () => "123", fetch: async () => new Response("", { status: 200 }) });
    await expect(runtime.execute({ ...request, input: { customerId: "other" } })).resolves.toMatchObject({ status: "failed", error: { code: "secret_payload_rejected" } });
    await expect(runtime.execute({ ...request, input: {} })).resolves.toMatchObject({ status: "failed", error: { code: "invalid_response" } });
    await expect(runtime.execute({ ...request, operation: "prepare" })).resolves.toMatchObject({ status: "prepared" });
  });
});

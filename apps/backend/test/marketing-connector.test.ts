import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryMarketingConnectorStore,
  MarketingConnectorRuntime,
  setMarketingConnectorStore,
} from "../src/customer-zero/marketing-connector.js";

describe("tenant marketing connector runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setMarketingConnectorStore(new InMemoryMarketingConnectorStore());
  });

  it("executes a verified Shopify read without leaking the admin token", async () => {
    const token = "shpat-secret-token";
    const store = new InMemoryMarketingConnectorStore();
    setMarketingConnectorStore(store);
    await store.put({
      organizationId: "org-a",
      userId: "user-a",
      provider: "shopify",
      credentials: { provider: "shopify", shopName: "acme", adminToken: token, apiVersion: "2026-07" },
      accountLabel: "acme.myshopify.com",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ products: [{ id: 7, title: "Producto" }] }), { status: 200 })));

    const result = await new MarketingConnectorRuntime().execute({
      requestId: "req-1",
      organizationId: "org-a",
      userId: "user-a",
      capability: "marketing.shopify.products.list",
      operation: "execute",
      input: {},
      sideEffect: false,
    });

    expect(result.status).toBe("succeeded");
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.output).toEqual([{ id: 7, title: "Producto", status: undefined, updatedAt: undefined, totalPrice: undefined }]);
  });

  it("keeps tenant credentials isolated and requires approval for writes", async () => {
    const store = new InMemoryMarketingConnectorStore();
    setMarketingConnectorStore(store);
    await store.put({
      organizationId: "org-a",
      userId: "user-a",
      provider: "wordpress",
      credentials: { provider: "wordpress", websiteUrl: "https://example.com", username: "a", password: "secret" },
      accountLabel: "example.com",
      verifiedAt: new Date().toISOString(),
      lastError: null,
    });
    const runtime = new MarketingConnectorRuntime();
    const isolated = await runtime.execute({
      requestId: "req-2",
      organizationId: "org-b",
      userId: "user-b",
      capability: "marketing.wordpress.posts.list",
      operation: "execute",
      input: {},
      sideEffect: false,
    });
    const prepared = await runtime.execute({
      requestId: "req-3",
      organizationId: "org-a",
      userId: "user-a",
      capability: "marketing.wordpress.posts.create",
      operation: "prepare",
      input: { title: "Draft", content: "Body" },
      sideEffect: true,
    });

    expect(isolated.status).toBe("credential_required");
    expect(prepared.status).toBe("prepared");
  });
});

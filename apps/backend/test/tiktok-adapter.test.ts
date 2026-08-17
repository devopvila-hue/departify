import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installExternalOAuthTokenStoreForTest,
  type ExternalOAuthTokenRecord,
} from "../src/customer-zero/external-oauth-tokens.js";
import { resolveTikTokReadKind, tiktokAdapter } from "../src/customer-zero/tiktok-adapter.js";

function record(overrides: Partial<ExternalOAuthTokenRecord> = {}): ExternalOAuthTokenRecord {
  return {
    organizationId: "org-tiktok",
    userId: "user-tiktok",
    provider: "tiktok_business",
    accessToken: "server-only-token",
    refreshToken: null,
    expiresAt: null,
    scopes: ["advertiser.read", "campaign.read", "report.read"],
    accountLabel: "Departify Ads",
    accountOptions: [{ id: "adv-1", label: "Departify Ads", kind: "advertiser" }],
    selectedAccountRef: "adv-1",
    operationalVerifiedAt: new Date().toISOString(),
    operationalProbeError: null,
    ...overrides,
  };
}

describe("TikTok direct read adapter", () => {
  afterEach(() => {
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    installExternalOAuthTokenStoreForTest(null);
    vi.unstubAllGlobals();
  });

  it("resolves business questions without exposing provider write actions", () => {
    expect(resolveTikTokReadKind("¿Cómo va el rendimiento de TikTok Ads?")).toBe("report");
    expect(resolveTikTokReadKind("¿Cuántas campañas tengo en TikTok?")).toBe("campaigns");
    expect(resolveTikTokReadKind("Enséñame mis vídeos de TikTok")).toBe("videos");
    expect(resolveTikTokReadKind("Quiero publicar en TikTok")).toBeNull();
  });

  it("reads campaigns through the tenant's selected advertiser", async () => {
    const store = {
      put: vi.fn(),
      get: vi.fn(async (organizationId: string, userId: string, provider: string) =>
        organizationId === "org-tiktok" && userId === "user-tiktok" && provider === "tiktok_business"
          ? record()
          : null),
      listForOrg: vi.fn(),
      remove: vi.fn(),
    };
    installExternalOAuthTokenStoreForTest(store);
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      expect(url).toContain("advertiser_id=adv-1");
      return new Response(JSON.stringify({
        code: 0,
        message: "OK",
        data: { list: [{ campaign_name: "Plan de verano", operation_status: "ENABLE" }] },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await tiktokAdapter.read({
      organizationId: "org-tiktok",
      userId: "user-tiktok",
      kind: "campaigns",
    });
    expect(result.campaigns).toEqual([{ name: "Plan de verano", status: "ENABLE" }]);
    expect(JSON.stringify(result)).not.toContain("server-only-token");
  });

  it("keeps organizations isolated", async () => {
    const store = {
      put: vi.fn(),
      get: vi.fn(async () => null),
      listForOrg: vi.fn(),
      remove: vi.fn(),
    };
    installExternalOAuthTokenStoreForTest(store);
    await expect(tiktokAdapter.read({
      organizationId: "org-other",
      userId: "user-tiktok",
      kind: "campaigns",
    })).rejects.toThrow("TIKTOK_NOT_CONNECTED");
  });
});

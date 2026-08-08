/**
 * P0-A — the API client attaches the authenticated token and drops it on
 * logout (security test cases 7 and 8 at the portal layer).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, setApiAccessToken } from "@/app/api";

function captureFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(init !== undefined ? { url, init } : { url });
      return {
        ok: true,
        status: 200,
        json: async () => ({ organizationId: "org-a" }),
      } as Response;
    }),
  );
  return calls;
}

describe("api auth header (P0-A)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setApiAccessToken(null);
  });

  it("7. protected API requests include the authenticated access token", async () => {
    const calls = captureFetch();
    setApiAccessToken("tok-123");
    await api.status("org-a");

    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok-123");
  });

  it("8. after logout the API client stops sending the token", async () => {
    const calls = captureFetch();
    setApiAccessToken(null);
    await api.status("org-a");

    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBeNull();
  });
});

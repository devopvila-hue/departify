/**
 * P0-A — the API client attaches the authenticated token and drops it on
 * logout (security test cases 7 and 8 at the portal layer).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    setApiAccessToken(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    setApiAccessToken(null);
    window.localStorage.clear();
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

  it("regression (P0 Google OAuth): first request after a top-level redirect is authenticated from the persisted Supabase session — even before AuthProvider's async getSession() resolves", async () => {
    // The browser top-level-redirects to /connections/google/callback
    // after Google consent. The JS bundle re-loads; the in-memory token
    // is null until AuthProvider's async `client.auth.getSession()` fires.
    // Supabase already persisted the session in localStorage under
    // `sb-<project-ref>-auth-token` (supabase-js v2 default). The portal
    // restores it synchronously at module load so the very first POST
    // (the OAuth code exchange) carries a valid Bearer token. Without
    // this fix the auth boundary rejected with 401 `missing_token` and
    // the founder saw the generic "No se pudo conectar Google" copy.
    vi.stubEnv("VITE_SUPABASE_URL", "https://test-ref.supabase.co");
    window.localStorage.setItem(
      "sb-test-ref-auth-token",
      JSON.stringify({
        access_token: "restored-jwt-xyz",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "refresh-xyz",
        user: { id: "u-1", email: "ceo@departify.app" },
      }),
    );
    vi.resetModules();
    const fresh = await import("@/app/api");
    const calls = captureFetch();
    // Simulate the OAuth callback POST. No setApiAccessToken call —
    // it would normally have been queued by AuthProvider's async
    // getSession() but the route effect has already fired.
    await fresh.api.finishGoogleConnect("org-a", "code-1", "nonce-1");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer restored-jwt-xyz");
  });

  it("regression: a malformed persisted session does not throw at module load", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://test-ref.supabase.co");
    window.localStorage.setItem("sb-test-ref-auth-token", "not-json{");
    vi.resetModules();
    const fresh = await import("@/app/api");
    const calls = captureFetch();
    await fresh.api.status("org-a");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBeNull();
  });
});

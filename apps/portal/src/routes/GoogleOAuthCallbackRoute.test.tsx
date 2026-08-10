/**
 * P0 — Customer Zero 03 + Sprint 60.
 *
 * End-to-end browser coverage of the Google OAuth handshake:
 *
 *   A. /conexiones: Gmail Configurar button has an actionable handler.
 *   B. Clicking it POSTs /api/customer-zero/:org/connections/:toolId/connect.
 *   C. The returned authorizationUrl triggers window.location.href assignment.
 *   D. The organization id used in the request matches the active session.
 *   E. The tool id used in the request is `gmail`.
 *   F. (covered in backend test) redirect_uri is exactly the
 *       https://app.departify.app/connections/google/callback URL.
 *   G. (covered in backend test) callback consumes code + state.
 *   H. On success the portal redirects to /conexiones.
 *   I. Failure paths never leak credentials, codes, scopes or provider
 *       payloads — only business-readable copy.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactElement } from "react";
import { useEffect } from "react";

import { OrgProvider } from "@/app/org-context";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import { GoogleOAuthCallbackRoute } from "@/routes/GoogleOAuthCallbackRoute";

function mountAt(ui: ReactElement, initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OrgProvider>{ui}</OrgProvider>
    </MemoryRouter>,
  );
}

function mockFetchSequence(handlers: Array<(url: string, body?: { code?: string; state?: string }) => unknown>) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const body =
        init?.body && typeof init.body === "string"
          ? (JSON.parse(init.body) as { code?: string; state?: string })
          : undefined;
      calls.push({ url, method, body });
      const handler = handlers[i++];
      const data = handler ? handler(url, body) : {};
      return {
        ok: true,
        status: 200,
        json: async () => data,
      } as Response;
    }),
  );
  return calls;
}

function LocationReporter(props: { onChange: (path: string) => void }) {
  const loc = useLocation();
  useEffect(() => {
    props.onChange(loc.pathname);
  }, [loc.pathname, props]);
  return null;
}

describe("Google OAuth handshake — portal side", () => {
  beforeEach(() => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    // jsdom does not implement navigation; we observe writes to
    // window.location.href instead.
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, href: "" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("A: Gmail Configurar button has an actionable handler and triggers the handshake", async () => {
    let connectCount = 0;
    mockFetchSequence([
      () => ({
        connections: [],
        cards: [
          {
            id: "gmail",
            name: "Gmail",
            category: "Correo",
            categoryId: "email",
            logoMark: "G",
            brandColor: "#ea4335",
            state: "not_connected",
            stateLabel: "No conectado",
            configSource: null,
            verifiedAt: null,
            capabilities: [],
            actionLabel: "Configurar",
            description: null,
          },
        ],
        unmappedTools: [],
      }),
      // /api/customer-zero/org_moon/connections/gmail/connect
      () => {
        connectCount++;
        return {
          organizationId: "org_moon",
          connection: {
            toolId: "gmail",
            label: "Gmail",
            capability: "email.send",
            category: "Correo",
            status: "connecting",
            authorizationUrl:
              "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=https%3A%2F%2Fapp.departify.app%2Fconnections%2Fgoogle%2Fcallback&response_type=code&scope=openid&state=nonce-1",
            oauthState: "nonce-1",
          },
        };
      },
    ]);
    mountAt(<ConnectionsRoute />, "/conexiones");

    const btn = await screen.findByRole("button", { name: /configurar/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(connectCount).toBe(1);
      expect(window.location.href).toContain(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
    });
  });

  it("B: clicking Configure POSTs /api/customer-zero/:org/connections/:toolId/connect with correct org + tool", async () => {
    let captured: { url: string; method: string } | null = null;
    mockFetchSequence([
      () => ({
        connections: [],
        cards: [
          {
            id: "gmail",
            name: "Gmail",
            category: "Correo",
            categoryId: "email",
            logoMark: "G",
            brandColor: "#ea4335",
            state: "not_connected",
            stateLabel: "No conectado",
            configSource: null,
            verifiedAt: null,
            capabilities: [],
            actionLabel: "Configurar",
            description: null,
          },
        ],
        unmappedTools: [],
      }),
      (url) => {
        captured = { url, method: "POST" };
        return {
          organizationId: "org_moon",
          connection: {
            toolId: "gmail",
            status: "connecting",
            authorizationUrl:
              "https://accounts.google.com/o/oauth2/v2/auth?state=nonce-2",
            oauthState: "nonce-2",
          },
        };
      },
    ]);
    mountAt(<ConnectionsRoute />, "/conexiones");
    const btn = await screen.findByRole("button", { name: /configurar/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(captured).not.toBeNull();
      expect(captured!.method).toBe("POST");
      expect(captured!.url).toBe(
        "/api/customer-zero/org_moon/connections/gmail/connect",
      );
    });
  });

  it("H+I: callback success navigates to /conexiones; failure never leaks credentials", async () => {
    let path = "/connections/google/callback";
    // 1. Successful callback path: POST returns a connected card.
    const successCalls: Array<{ url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body =
          init?.body && typeof init.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : undefined;
        successCalls.push({ url, body });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            organizationId: "org_moon",
            connection: {
              toolId: "gmail",
              status: "connected",
            },
            identity: { email: "ceo@departify.app" },
          }),
        } as Response;
      }),
    );
    mountAt(
      <>
        <LocationReporter onChange={(p) => (path = p)} />
        <Routes>
          <Route
            path="/connections/google/callback"
            element={<GoogleOAuthCallbackRoute />}
        />
          <Route path="/conexiones" element={<div data-testid="conexiones" />} />
        </Routes>
      </>,
      "/connections/google/callback?code=auth-code-xyz&state=nonce-3",
    );
    await waitFor(() => expect(path).toBe("/conexiones"));
    expect(successCalls[0]?.url).toBe(
      "/api/customer-zero/org_moon/connections/gmail/callback",
    );
    // The outgoing request body must contain the OAuth code + state but
    // never a refresh_token, client_secret or access_token.
    const serialized = JSON.stringify(successCalls[0]?.body ?? {});
    expect(serialized).toContain("auth-code-xyz");
    expect(serialized).toContain("nonce-3");
    expect(serialized).not.toMatch(/refresh[_-]?token/i);
    expect(serialized).not.toMatch(/access[_-]?token/i);
    expect(serialized).not.toMatch(/client[_-]?secret/i);
  });

  it("I: callback with Google error=access_denied renders business copy and never calls the backend", async () => {
    let path = "/connections/google/callback";
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls++;
        return { ok: true, json: async () => ({}) } as Response;
      }),
    );
    mountAt(
      <>
        <LocationReporter onChange={(p) => (path = p)} />
        <Routes>
          <Route
            path="/connections/google/callback"
            element={<GoogleOAuthCallbackRoute />}
          />
          <Route path="/conexiones" element={<div data-testid="conexiones" />} />
        </Routes>
      </>,
      "/connections/google/callback?error=access_denied",
    );
    expect(
      await screen.findByText(
        /cancelled the authorization|cancelado la autorizaci[oó]n/i,
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(fetchCalls).toBe(0));
    expect(path).toBe("/connections/google/callback");
  });

  it("I: callback with missing code renders business copy and never calls the backend", async () => {
    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls++;
        return { ok: true, json: async () => ({}) } as Response;
      }),
    );
    mountAt(
      <Routes>
        <Route
          path="/connections/google/callback"
          element={<GoogleOAuthCallbackRoute />}
        />
      </Routes>,
      "/connections/google/callback",
    );
    await screen.findByText(/no se completó correctamente|no se pudo conectar/i);
    expect(fetchCalls).toBe(0);
  });

  it("regression (P0 Google OAuth): backend error code `missing_token` surfaces the re-login hint instead of the generic Spanish fallback", async () => {
    // Defense in depth: even if the synchronous token-restore fix ever
    // regresses, an auth-boundary 401 with `error.code = "missing_token"`
    // must tell the CEO to re-login instead of the generic copy.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: false,
          status: 401,
          json: async () => ({
            error: {
              code: "missing_token",
              message: "Authentication failed.",
              requestId: "req-test",
              statusCode: 401,
            },
          }),
        } as Response;
      }),
    );
    mountAt(
      <Routes>
        <Route
          path="/connections/google/callback"
          element={<GoogleOAuthCallbackRoute />}
        />
      </Routes>,
      "/connections/google/callback?code=c&state=s",
    );
    expect(
      await screen.findByText(/sesión ha caducado|sign out, sign back in/i),
    ).toBeInTheDocument();
  });
});

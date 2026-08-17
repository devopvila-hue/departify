/**
 * P0 — ShellGate URL-preservation regression suite.
 *
 * The bug: an onboarded CEO refreshing /chat, /conexiones or /tareas
 * could be redirected to "/" by ShellGate if `api.overview` returned
 * `null` (network blip / 5xx), then bounced through the onboarding
 * flash before landing back on the original URL.
 *
 * Invariant under test: while boot data is unresolved, ShellGate
 * renders a neutral boot surface IN PLACE — it must NOT navigate.
 * Only a positively known "no authenticated user" case redirects to "/".
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrgProvider } from "@/app/org-context";

const authRef: { current: { user: { id: string } | null; loading: boolean } } =
  {
    current: { user: null, loading: true },
  };
vi.mock("@/app/auth-context", () => ({
  useAuth: () => authRef.current,
}));

import { ShellGate } from "@/components/ShellGate";

function okJson(payload: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
    headers: new Headers(),
  } as Response);
}

function errorJson(status: number, payload: unknown): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => payload,
    headers: new Headers(),
  } as Response);
}

function LocationSpy(props: { onChange: (path: string) => void }) {
  // Side effect — capture pathname without affecting rendering.
  const loc = useLocation();
  props.onChange(loc.pathname);
  return null;
}

function ConnectionsStub() {
  return <div data-testid="conexiones-page">conexiones</div>;
}

const flush = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function mountGate(initialPath: string, onPath: (p: string) => void) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OrgProvider>
        <LocationSpy onChange={onPath} />
        <Routes>
          <Route element={<ShellGate />}>
            <Route path="/conexiones" element={<ConnectionsStub />} />
          </Route>
        </Routes>
      </OrgProvider>
    </MemoryRouter>,
  );
}

const onboardedMe = {
  user: { id: "u-1", email: "ceo@departify.app" },
  organizations: [{ organizationId: "org_moon", name: "Moon" }],
};

describe("ShellGate — URL preservation across hydration (P0)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: null, loading: true };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("C. refreshing /conexiones stays on /conexiones across a transient api.overview failure", async () => {
    authRef.current = { user: onboardedMe.user, loading: false };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon/overview")) {
          // Transient failure — must NOT redirect to "/".
          return errorJson(503, { error: "down" });
        }
        return okJson({});
      }),
    );

    let lastPath = "";
    mountGate("/conexiones", (p) => (lastPath = p));
    // Give the failure and the redirect attempt time to fire.
    await flush(250);
    // The user must still be on /conexiones, not "/".
    expect(lastPath).toBe("/conexiones");
    // The shell must not wait for a non-critical overview projection.
    expect(screen.queryByTestId("conexiones-page")).toBeInTheDocument();
    // No onboarding flash.
    expect(
      screen.queryByText(/cuéntame lo mínimo sobre tu empresa/i),
    ).toBeNull();
  });

  it("happy path: refreshing /conexiones with a healthy backend stays on /conexiones and renders the page", async () => {
    authRef.current = { user: onboardedMe.user, loading: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon/overview")) {
          return okJson({
            organizationId: "org_moon",
            companyName: "Moon",
            decisions: [],
            stats: {},
          });
        }
        return okJson({});
      }),
    );

    let lastPath = "";
    mountGate("/conexiones", (p) => (lastPath = p));
    expect(
      await screen.findByTestId("conexiones-page", {}, { timeout: 1500 }),
    ).toBeInTheDocument();
    expect(lastPath).toBe("/conexiones");
  });

  it("redirects to '/' ONLY when there is positively no authenticated user", async () => {
    authRef.current = { user: null, loading: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({})),
    );
    let lastPath = "/conexiones";
    render(
      <MemoryRouter initialEntries={["/conexiones"]}>
        <OrgProvider>
          <LocationSpy onChange={(p) => (lastPath = p)} />
          <Routes>
            <Route element={<ShellGate />}>
              <Route path="/conexiones" element={<ConnectionsStub />} />
            </Route>
            <Route path="/" element={<div data-testid="root-stub">root</div>} />
          </Routes>
        </OrgProvider>
      </MemoryRouter>,
    );
    await flush(200);
    expect(lastPath).toBe("/");
  });
});

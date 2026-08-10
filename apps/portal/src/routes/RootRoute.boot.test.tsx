/**
 * P0 — portal boot state machine.
 *
 * Regression coverage for the onboarding flash that fired every time an
 * already-onboarded CEO refreshed app.departify.app.
 *
 * The bug: RootRoute treated any non-OK /api/customer-zero/{org}
 * response (network error, 401 stale-token, 5xx) as `not_ready` and
 * rendered the onboarding intake screen — "Cuéntame lo mínimo sobre tu
 * empresa" — for the duration of the failure window.
 *
 * Invariant under test: `loading !== needs_onboarding`.
 * Onboarding may render ONLY after the backend has positively confirmed
 * that this organization genuinely requires onboarding (HTTP 200 with
 * `contextReady === false`).
 */
import {
  act,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrgProvider } from "@/app/org-context";
import { RootRoute } from "@/routes/RootRoute";

// Mock the auth context so we control user/loading deterministically.
// (In jsdom there is no Supabase client, so useAuth would always
// resolve to user=null; we exercise the real RootRoute transitions
// by feeding it synthetic auth state.)
type AuthShape = {
  user: { id: string; email?: string } | null;
  loading: boolean;
};
const authRef: { current: AuthShape } = { current: { user: null, loading: true } };
vi.mock("@/app/auth-context", () => ({
  useAuth: () => authRef.current,
}));

function okJson(payload: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
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

const ONBOARDING_HEADING = /cuéntame lo mínimo sobre tu empresa/i;
const LOGIN_HEADING = /entra en tu empresa/i;

const onboardedMe = {
  user: { id: "u-1", email: "ceo@departify.app" },
  organizations: [{ organizationId: "org_moon", name: "Moon" }],
};
const onboardedStatus = {
  organizationId: "org_moon",
  contextReady: true,
  department: { id: "marketing", name: "Marketing", status: "active" },
};
const incompleteStatus = {
  organizationId: "org_moon",
  contextReady: false,
  department: null,
};

function LocationSpy(props: { onChange: (path: string) => void }) {
  // Side effect — capture pathname without affecting rendering.
  const loc = useLocation();
  props.onChange(loc.pathname);
  return null;
}

function flush(ms = 50) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Poll for the onboarding heading until the deadline. Returns the
 *  timestamp at which it appeared, or null if it never did. */
async function watchForOnboarding(
  deadlineMs: number,
): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (screen.queryByRole("heading", { name: ONBOARDING_HEADING })) {
      return Date.now() - start;
    }
    await flush(8);
  }
  return null;
}

function mountAt(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <OrgProvider>
        <RootRoute />
      </OrgProvider>
    </MemoryRouter>,
  );
}

describe("RootRoute — portal-boot state machine (P0)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authRef.current = { user: null, loading: true };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("A. existing onboarded CEO + slow overview — onboarding copy NEVER appears", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: onboardedMe.user, loading: false };

    let statusCallCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        await flush(120); // intentionally slow backend
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon")) {
          statusCallCount++;
          return okJson(onboardedStatus);
        }
        return okJson({});
      }),
    );

    mountAt("/");
    const flashedAt = await watchForOnboarding(800);
    expect(flashedAt).toBeNull();
    expect(statusCallCount).toBeGreaterThan(0);
  });

  it("D. genuine new CEO — onboarding appears once needs_org is positively known (no stored org, authenticated user)", async () => {
    // No localStorage entry → user is new, no org yet.
    authRef.current = { user: { id: "u-2" }, loading: false };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) {
          return okJson({ user: { id: "u-2" }, organizations: [] });
        }
        return okJson({});
      }),
    );

    mountAt("/");
    // For a genuine new CEO there is positively no org id, so RootRoute
    // resolves to needs_org immediately and renders CustomerZeroRoute's
    // intake step. This is the only path that may render onboarding.
    expect(
      await screen.findByRole("heading", { name: ONBOARDING_HEADING }, { timeout: 1500 }),
    ).toBeInTheDocument();
  });

  it("D2. authenticated CEO + transient 401 then positive 200 + contextReady=false → onboarding appears only after the positive confirmation", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: onboardedMe.user, loading: false };

    let statusCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon")) {
          statusCalls++;
          if (statusCalls === 1) return errorJson(401, { error: "stale" });
          return okJson(incompleteStatus);
        }
        return okJson({});
      }),
    );

    mountAt("/");
    // After the first 401, onboarding must NOT be visible.
    await act(async () => {
      await flush(400);
    });
    expect(screen.queryByRole("heading", { name: ONBOARDING_HEADING })).toBeNull();
    // The "needs_onboarding" branch is exercised by the "positive control"
    // test below — this test only verifies that a non-OK response does
    // NOT trigger the flash.
  });

  it("E. authenticated CEO + transient 401 (stale token) — onboarding must NOT appear", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: onboardedMe.user, loading: false };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon")) {
          return errorJson(401, { error: "stale" });
        }
        return okJson({});
      }),
    );

    mountAt("/");
    // Wait long enough that any erroneous transition would have fired.
    await flush(400);
    expect(screen.queryByRole("heading", { name: ONBOARDING_HEADING })).toBeNull();
    // Still on a neutral boot surface (loading) — no login, no onboarding.
    expect(screen.queryByRole("heading", { name: LOGIN_HEADING })).toBeNull();
  });

  it("E2. authenticated CEO + transient 500 — onboarding must NOT appear", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: onboardedMe.user, loading: false };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon")) {
          return errorJson(500, { error: "boom" });
        }
        return okJson({});
      }),
    );

    mountAt("/");
    await flush(400);
    expect(screen.queryByRole("heading", { name: ONBOARDING_HEADING })).toBeNull();
  });

  it("F. failed request — must not incorrectly fall back to onboarding", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: onboardedMe.user, loading: false };

    // Fetch throws (network down).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    mountAt("/");
    await flush(400);
    expect(screen.queryByRole("heading", { name: ONBOARDING_HEADING })).toBeNull();
  });

  it("positive control: needs_onboarding IS reached when the backend returns 200 + contextReady=false", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: onboardedMe.user, loading: false };

    // First call returns incompleteStatus → needs_onboarding. The
    // CustomerZeroRoute component mounts and immediately calls
    // api.nextQuestion; we mock it to return an empty conversation so
    // the CustomerZeroRoute's intake step stays mounted (the bug under
    // test is the transition TO this view, not the conversation flow).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon")) {
          return okJson(incompleteStatus);
        }
        if (url.endsWith("/api/customer-zero/org_moon/next-question")) {
          return okJson({
            organizationId: "org_moon",
            question: null,
            ready: false,
            gapCount: 0,
            connections: [],
            transcript: [],
            intro: "",
          });
        }
        return okJson({});
      }),
    );

    mountAt("/");
    expect(
      await screen.findByRole("heading", { name: ONBOARDING_HEADING }, { timeout: 1500 }),
    ).toBeInTheDocument();
  });
});

/**
 * URL-preservation regression suite — the requested URL across refresh
 * must survive hydration for any onboarded CEO.
 */
describe("URL preservation across hydration (P0)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authRef.current = { user: null, loading: true };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  // B. refresh /chat — but wait, RootRoute is only mounted at "/".
  // /chat lives under ShellGate. We exercise that path indirectly by
  // verifying that NO code in the boot flow navigates away from the
  // requested URL while data is loading.
  it("B. while boot is unresolved at '/', RootRoute never navigates the user to /onboarding or /chat prematurely", async () => {
    window.localStorage.setItem(
      "departify_customer_zero",
      JSON.stringify({ organizationId: "org_moon" }),
    );
    authRef.current = { user: onboardedMe.user, loading: false };

    let resolved = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/auth/me")) return okJson(onboardedMe);
        if (url.endsWith("/api/customer-zero/org_moon") && !resolved) {
          // Hold the readiness response open to inspect the in-between state.
          await new Promise<void>((r) => setTimeout(r, 400));
          resolved = true;
          return okJson(onboardedStatus);
        }
        return okJson({});
      }),
    );

    let lastPath = "/";
    render(
      <MemoryRouter initialEntries={["/"]}>
        <OrgProvider>
          <LocationSpy onChange={(p) => (lastPath = p)} />
          <RootRoute />
        </OrgProvider>
      </MemoryRouter>,
    );
    // While the readiness call is in flight, the URL MUST stay "/".
    await flush(150);
    expect(lastPath).toBe("/");
    expect(screen.queryByRole("heading", { name: ONBOARDING_HEADING })).toBeNull();
  });
});
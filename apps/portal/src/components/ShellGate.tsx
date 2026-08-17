import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { api } from "@/app/api";
import { useAuth } from "@/app/auth-context";
import { useOrg } from "@/app/org-context";
import { AppShell } from "@/components/AppShell";

/**
 * Guards the portal (Phase P0-A + portal-boot fix): the shell exists only
 * for an authenticated user with a real organization. Identity is Supabase;
 * the organization id is a navigation preference that the backend
 * re-validates on every call. Without an authenticated user, back to "/".
 *
 * STRICT INVARIANT — the requested URL is preserved across hydration.
 * While auth / overview are loading we render a neutral boot screen IN
 * PLACE — never redirect to "/". A transient `api.overview` failure
 * (network / 5xx) is treated as "still loading" and retried, NOT as
 * "missing" (which would force a redirect to "/" and bounce the CEO
 * through the onboarding flash).
 */
export function ShellGate() {
  const { user, loading } = useAuth();
  const { organizationId } = useOrg();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "ready"; companyName: string; pendingApprovals: number }
    | { status: "missing" }
  >({ status: "loading" });

  useEffect(() => {
    if (!user || !organizationId) {
      setState({ status: "missing" });
      return;
    }
    let cancelled = false;
    void (async () => {
      const overview = await api.overview(organizationId);
      if (cancelled) return;
      if (!overview) {
        // Transient failure — stay in "loading" so the user keeps their
        // current URL. The next navigation or refresh will retry.
        setState({ status: "loading" });
        return;
      }
      setState({
        status: "ready",
        companyName: overview.companyName,
        pendingApprovals: overview.decisions.filter(
          (d) => d.status === "pending",
        ).length,
      });
    })();
    return () => {
      cancelled = true;
    };
    // The overview is shared by the portal cache. It is intentionally not
    // re-read on every route change; route navigation must not be gated by a
    // second multi-source overview projection.
  }, [user, organizationId]);

  if (loading) {
    return (
      <div className="dfy-boot" role="status">
        <p>Abriendo tu empresa…</p>
      </div>
    );
  }
  // Only redirect to "/" when we positively know there is no authenticated
  // user. A transient api.overview failure or an in-flight auth refresh
  // must NOT bounce the CEO through "/" — that path can render the
  // onboarding screen and cause the refresh flash.
  if (!user) {
    return <Navigate to="/" replace />;
  }
  if (state.status === "missing") {
    // The user is authenticated but has no organization id yet — the
    // RootRoute onboarding flow owns that case. We redirect to "/" so
    // it can decide; this path never renders onboarding from the shell.
    return <Navigate to="/" replace />;
  }
  if (state.status === "loading") {
    return (
      <div className="dfy-boot" role="status">
        <p>Cargando tu empresa…</p>
      </div>
    );
  }
  return (
    <AppShell
      companyName={state.companyName}
      pendingApprovals={state.pendingApprovals}
    />
  );
}

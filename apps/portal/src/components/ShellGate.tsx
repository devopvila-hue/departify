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
 * While auth is loading we render a neutral boot screen IN PLACE — never
 * redirect to "/". Once identity and organization are known, the shell
 * renders immediately; the overview only hydrates its company name and
 * approval badge in the background.
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
    setState({
      status: "ready",
      companyName: "Tu empresa",
      pendingApprovals: 0,
    });
    let cancelled = false;
    void (async () => {
      const overview = await api.overview(organizationId);
      if (cancelled) return;
      if (!overview) return;
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
  if (state.status === "loading") {
    return (
      <div className="dfy-boot" role="status">
        <p>Abriendo tu empresa…</p>
      </div>
    );
  }
  if (state.status === "missing") {
    // The user is authenticated but has no organization id yet — the
    // RootRoute onboarding flow owns that case. We redirect to "/" so
    // it can decide; this path never renders onboarding from the shell.
    return <Navigate to="/" replace />;
  }
  return (
    <AppShell
      companyName={state.companyName}
      pendingApprovals={state.pendingApprovals}
    />
  );
}

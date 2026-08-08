import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { api } from "@/app/api";
import { useAuth } from "@/app/auth-context";
import { useOrg } from "@/app/org-context";
import { AppShell } from "@/components/AppShell";

/**
 * Guards the portal (Phase P0-A): the shell exists only for an authenticated
 * user with a real organization. Identity is Supabase; the organization id is
 * a navigation preference that the backend re-validates on every call.
 * Without an authenticated user or organization, back to "/".
 */
export function ShellGate() {
  const { user, loading } = useAuth();
  const { organizationId } = useOrg();
  const location = useLocation();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; companyName: string; pendingApprovals: number } | { status: "missing" }
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
        setState({ status: "missing" });
        return;
      }
      setState({
        status: "ready",
        companyName: overview.companyName,
        pendingApprovals: overview.decisions.filter((d) => d.status === "pending").length,
      });
    })();
    return () => {
      cancelled = true;
    };
    // Re-read on navigation so the pending count stays truthful.
  }, [user, organizationId, location.pathname]);

  if (loading) {
    return (
      <div className="dfy-boot" role="status">
        <p>Abriendo tu empresa…</p>
      </div>
    );
  }
  if (!user || state.status === "missing") {
    return <Navigate to="/" replace />;
  }
  if (state.status === "loading") {
    return (
      <div className="dfy-boot" role="status">
        <p>Abriendo tu empresa…</p>
      </div>
    );
  }
  return <AppShell companyName={state.companyName} pendingApprovals={state.pendingApprovals} />;
}

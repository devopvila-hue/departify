import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { api } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { AppShell } from "@/components/AppShell";

/**
 * Guards the portal: the shell only exists once the CEO has a company with
 * its department. Without one, back to onboarding.
 */
export function ShellGate() {
  const { organizationId } = useOrg();
  const location = useLocation();
  const [state, setState] = useState<
    { status: "loading" } | { status: "ready"; companyName: string; pending: number } | { status: "missing" }
  >({ status: "loading" });

  useEffect(() => {
    if (!organizationId) {
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
        pending: overview.decisions.filter((d) => d.status === "pending").length,
      });
    })();
    return () => {
      cancelled = true;
    };
    // Re-read on navigation so the pending count stays truthful.
  }, [organizationId, location.pathname]);

  if (state.status === "missing") {
    return <Navigate to="/" replace />;
  }
  if (state.status === "loading") {
    return (
      <div className="dfy-boot" role="status">
        <p>Abriendo tu empresa…</p>
      </div>
    );
  }
  return <AppShell companyName={state.companyName} pending={state.pending} />;
}

/**
 * Root route — Customer Zero hotfix.
 *
 * The decision tree for "/":
 *
 *   loading            → boot screen
 *   no session         → login / register
 *   session, no org    → onboarding (creates the real organization)
 *   session + org + NOT contextReady → onboarding (continue Customer Zero)
 *   session + org + contextReady   → central chat
 *
 * Customer Zero readiness is a STRUCTURAL backend gate. The portal
 * consults `contextReady` from `api.statusDetailed` — it never
 * infers readiness from the presence of an organization id, because
 * a brand-new organization (post intake) has an id but is NOT
 * ready. The pre-hotfix RootRoute redirected to /inicio whenever
 * the org id existed; that was the regression.
 *
 * On login the selected organization is restored from the user's REAL
 * memberships (backend-authoritative). localStorage only remembers
 * the chosen organization for navigation — it is never authorization.
 */

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/app/auth-context";
import { useOrg, readStoredOrganizationId } from "@/app/org-context";
import { api } from "@/app/api";
import { AuthScreen } from "@/routes/AuthScreen";
import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

type ReadyState = "loading" | "not_ready" | "ready" | "no_org" | "no_session";

export function RootRoute() {
  const { user, loading } = useAuth();
  const { organizationId, setOrganizationId } = useOrg();
  const [restoring, setRestoring] = useState(false);
  const [ready, setReady] = useState<ReadyState>("loading");

  // Restore the selected organization from the user's REAL memberships.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      setRestoring(true);
      try {
        const me = await api.me();
        if (cancelled) return;
        if (me && me.organizations.length > 0) {
          const stored = readStoredOrganizationId();
          const selected =
            me.organizations.find((org) => org.organizationId === stored) ??
            me.organizations[0];
          if (selected) setOrganizationId(selected.organizationId);
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, setOrganizationId]);

  // Customer Zero readiness — STRUCTURAL backend gate. The portal
  // never decides readiness itself; it only consults the backend.
  useEffect(() => {
    if (!user || !organizationId) {
      setReady(organizationId ? "no_session" : "no_org");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.statusDetailed(organizationId);
        if (cancelled) return;
        if (result === null || result.status === 404) {
          setReady("no_session");
          return;
        }
        const status = result.data;
        if (!status) {
          setReady("not_ready");
          return;
        }
        // The status endpoint exposes contextReady — the structural
        // backend gate result. We trust it.
        setReady(status.contextReady ? "ready" : "not_ready");
      } catch {
        setReady("not_ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, organizationId]);

  if (loading || restoring) {
    return (
      <div className="dfy-boot" role="status">
        <p>Abriendo tu empresa…</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (!organizationId) {
    return <CustomerZeroRoute />;
  }

  // Customer Zero hotfix — until the backend says the org is ready,
  // we stay in onboarding. /inicio is forbidden for a not-ready org
  // even if the org id is set (the regression).
  if (ready === "loading" || ready === "no_session") {
    return (
      <div className="dfy-boot" role="status">
        <p>Cargando tu empresa…</p>
      </div>
    );
  }

  if (ready === "not_ready") {
    return <CustomerZeroRoute />;
  }

  // ready === "ready" — the CEO has completed Customer Zero.
  return <Navigate to="/chat" replace />;
}

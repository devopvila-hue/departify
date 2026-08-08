/**
 * Root route — Phase P0-A.
 *
 * The decision tree for "/":
 *
 *   loading            → boot screen
 *   no session         → login / register
 *   session, no org    → onboarding (creates the real organization)
 *   session + org      → the portal (Chat)
 *
 * On login the selected organization is restored from the user's REAL
 * memberships (backend-authoritative). localStorage only remembers the chosen
 * organization for navigation — it is never authorization.
 */

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/app/auth-context";
import { useOrg, readStoredOrganizationId } from "@/app/org-context";
import { api } from "@/app/api";
import { AuthScreen } from "@/routes/AuthScreen";
import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

export function RootRoute() {
  const { user, loading } = useAuth();
  const { organizationId, setOrganizationId } = useOrg();
  const [restoring, setRestoring] = useState(false);

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

  return <Navigate to="/chat" replace />;
}

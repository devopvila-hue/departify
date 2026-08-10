/**
 * Root route — Customer Zero hotfix + portal-boot fix.
 *
 * The decision tree for "/":
 *
 *   loading             → boot screen ("Cargando tu empresa…")
 *   needs_session       → login / register (no authenticated user yet)
 *   needs_org           → onboarding (start a brand-new organization)
 *   needs_onboarding    → onboarding (continue Customer Zero — backend
 *                          CONFIRMED contextReady=false on a 200)
 *   ready               → central chat (backend CONFIRMED contextReady=true)
 *
 * STRICT INVARIANT — "loading !== needs_onboarding".
 *
 * Customer Zero onboarding may render ONLY after the backend has positively
 * confirmed that this organization genuinely requires onboarding
 * (HTTP 200 with `contextReady === false`). Network errors, 401/403 (stale
 * session, auth refresh in flight), 5xx, or empty responses MUST NOT be
 * treated as "needs onboarding" — that was the previous regression and
 * caused a flash of the intake screen on every refresh when the Supabase
 * access token was mid-refresh.
 *
 * On login the selected organization is restored from the user's REAL
 * memberships (backend-authoritative). localStorage only remembers the
 * chosen organization for navigation — it is never authorization.
 */

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { useAuth } from "@/app/auth-context";
import { useOrg, readStoredOrganizationId } from "@/app/org-context";
import { api } from "@/app/api";
import { AuthScreen } from "@/routes/AuthScreen";
import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

type ReadyState =
  | "loading"
  | "needs_session"
  | "needs_org"
  | "needs_onboarding"
  | "ready";

export function RootRoute() {
  const { user, loading: authLoading } = useAuth();
  const { organizationId, setOrganizationId } = useOrg();
  const [ready, setReady] = useState<ReadyState>("loading");

  // Restore the selected organization from the user's REAL memberships.
  // This is a navigation preference (which org to open), not authorization.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
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
      } catch {
        /* network error — keep the stored org id, the readiness check
           below will retry and surface an honest state. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, setOrganizationId]);

  // Customer Zero readiness — STRUCTURAL backend gate. The portal
  // never decides readiness itself; it only consults the backend.
  //
  // ONLY a 200 response with `contextReady === false` transitions to
  // `needs_onboarding`. Anything else (auth refresh in flight, transient
  // 5xx, network error) stays in `loading` so an existing onboarded CEO
  // NEVER sees the onboarding flash on refresh.
  useEffect(() => {
    // While auth is still resolving we do not know enough to render
    // anything other than the boot screen.
    if (authLoading) {
      setReady("loading");
      return;
    }
    if (!user) {
      setReady("needs_session");
      return;
    }
    if (!organizationId) {
      setReady("needs_org");
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await api.statusDetailed(organizationId);
      if (cancelled) return;
      // Network error → stay loading. The next refresh / retry will
      // resolve. We never infer "needs onboarding" from a missing body.
      if (result === null) {
        setReady("loading");
        return;
      }
      // 404 means the org id on the client is stale. The org is genuinely
      // absent — onboarding (start over) is the correct destination.
      if (result.status === 404) {
        setReady("needs_org");
        return;
      }
      // 401/403 means auth is mid-refresh or the user lost access.
      // Treat as loading, NOT as onboarding — it is recoverable.
      if (result.status === 401 || result.status === 403) {
        setReady("loading");
        return;
      }
      // Any other non-OK (5xx etc.) with no body → loading. We refuse
      // to fall back to onboarding on a server error.
      if (result.status < 200 || result.status >= 300) {
        setReady("loading");
        return;
      }
      const status = result.data;
      if (!status) {
        setReady("loading");
        return;
      }
      // Positive confirmation only.
      setReady(status.contextReady ? "ready" : "needs_onboarding");
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, organizationId]);

  if (ready === "loading") {
    return (
      <div className="dfy-boot" role="status">
        <p>Cargando tu empresa…</p>
      </div>
    );
  }

  if (ready === "needs_session") {
    return <AuthScreen />;
  }

  if (ready === "needs_org") {
    return <CustomerZeroRoute />;
  }

  if (ready === "needs_onboarding") {
    return <CustomerZeroRoute />;
  }

  // ready === "ready" — the CEO has completed Customer Zero.
  return <Navigate to="/chat" replace />;
}
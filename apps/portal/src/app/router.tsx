import { createBrowserRouter, Navigate, useNavigate } from "react-router-dom";

import { ChatRoute } from "@/routes/ChatRoute";
import { CompanyRoute } from "@/routes/CompanyRoute";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import { ControlPlaneRoute } from "@/routes/ControlPlaneRoute";
import { DecisionsRoute } from "@/routes/DecisionsRoute";
import { DepartmentsRoute } from "@/routes/DepartmentsRoute";
import { GoogleOAuthCallbackRoute } from "@/routes/GoogleOAuthCallbackRoute";
import { MetaOAuthCallbackRoute } from "@/routes/MetaOAuthCallbackRoute";
import { InboxRoute } from "@/routes/InboxRoute";
import { MarketingRoute } from "@/routes/MarketingRoute";
import { ResultsRoute } from "@/routes/ResultsRoute";
import { RootRoute } from "@/routes/RootRoute";
import { SettingsRoute } from "@/routes/SettingsRoute";
import { ShellGate } from "@/components/ShellGate";
import { TasksRoute } from "@/routes/TasksRoute";

export function RouteErrorFallback() {
  const navigate = useNavigate();
  return (
    <main className="dfy-page" role="alert">
      <h1>No hemos podido abrir esta sección</h1>
      <p>Ha ocurrido un problema inesperado. Puedes volver al portal y continuar desde allí.</p>
      <button type="button" className="dfy-button" onClick={() => navigate("/conexiones", { replace: true })}>
        Volver a Conexiones
      </button>
    </main>
  );
}

/**
 * Departify information architecture.
 *
 *   /                    → identity + onboarding (RootRoute)
 *   /inicio              → TU EMPRESA (Control Plane, org chart) — ENGINE 04
 *   /chat                → THE central conversation
 *   /tareas              → operational inbox of real work items
 *   /inbox               → unified business inbox (CZ03)
 *   /departamentos       → active + future departments
 *   /conexiones          → capability-first connection management
 *   /aprobaciones        → inbox of approvals (DecisionesRoute)
 *   /resultados          → historical archive of results
 *   /empresa             → Company DNA
 *   /configuracion       → operational preferences and connection states
 *   /marketing           → Marketing department detail + Elvira
 *   /decisiones          → legacy alias for /aprobaciones
 */

export const router = createBrowserRouter([
  { path: "/", element: <RootRoute />, errorElement: <RouteErrorFallback /> },
  // P0 — the Google OAuth callback MUST be able to complete the
  // server-side exchange regardless of the shell gate. It is registered
  // OUTSIDE ShellGate so no auth/org/overview gate can redirect the
  // callback page away and silently drop code+state (which left the
  // connection stuck in "connecting" forever). Auth/org failures are
  // surfaced as a business-readable error INSIDE this route instead.
  {
    path: "/connections/google/callback",
    element: <GoogleOAuthCallbackRoute />,
    errorElement: <RouteErrorFallback />,
  },
  {
    path: "/connections/meta_business/callback",
    element: <MetaOAuthCallbackRoute />,
    errorElement: <RouteErrorFallback />,
  },
  {
    element: <ShellGate />,
    errorElement: <RouteErrorFallback />,
    children: [
      { path: "/inicio", element: <ControlPlaneRoute /> },
      { path: "/chat", element: <ChatRoute /> },
      { path: "/tareas", element: <TasksRoute /> },
      { path: "/inbox", element: <InboxRoute /> },
      { path: "/departamentos", element: <DepartmentsRoute /> },
      { path: "/conexiones", element: <ConnectionsRoute /> },
      { path: "/aprobaciones", element: <DecisionsRoute /> },
      { path: "/resultados", element: <ResultsRoute /> },
      { path: "/empresa", element: <CompanyRoute /> },
      { path: "/configuracion", element: <SettingsRoute /> },
      { path: "/marketing", element: <MarketingRoute /> },
      { path: "/decisiones", element: <DecisionsRoute /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace />, errorElement: <RouteErrorFallback /> },
]);

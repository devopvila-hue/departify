import { createBrowserRouter, Navigate } from "react-router-dom";

import { ChatRoute } from "@/routes/ChatRoute";
import { CompanyRoute } from "@/routes/CompanyRoute";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import { ControlPlaneRoute } from "@/routes/ControlPlaneRoute";
import { DecisionsRoute } from "@/routes/DecisionsRoute";
import { DepartmentsRoute } from "@/routes/DepartmentsRoute";
import { GoogleOAuthCallbackRoute } from "@/routes/GoogleOAuthCallbackRoute";
import { InboxRoute } from "@/routes/InboxRoute";
import { MarketingRoute } from "@/routes/MarketingRoute";
import { ResultsRoute } from "@/routes/ResultsRoute";
import { RootRoute } from "@/routes/RootRoute";
import { ShellGate } from "@/components/ShellGate";
import { TasksRoute } from "@/routes/TasksRoute";

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
 *   /configuracion       → advanced settings (placeholder)
 *   /marketing           → Marketing department detail + Elvira
 *   /decisiones          → legacy alias for /aprobaciones
 */

export const router = createBrowserRouter([
  { path: "/", element: <RootRoute /> },
  {
    element: <ShellGate />,
    children: [
      { path: "/inicio", element: <ControlPlaneRoute /> },
      { path: "/chat", element: <ChatRoute /> },
      { path: "/tareas", element: <TasksRoute /> },
      { path: "/inbox", element: <InboxRoute /> },
      { path: "/departamentos", element: <DepartmentsRoute /> },
      { path: "/conexiones", element: <ConnectionsRoute /> },
      {
        path: "/connections/google/callback",
        element: <GoogleOAuthCallbackRoute />,
      },
      { path: "/aprobaciones", element: <DecisionsRoute /> },
      { path: "/resultados", element: <ResultsRoute /> },
      { path: "/empresa", element: <CompanyRoute /> },
      { path: "/configuracion", element: <CompanyRoute /> },
      { path: "/marketing", element: <MarketingRoute /> },
      { path: "/decisiones", element: <DecisionsRoute /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

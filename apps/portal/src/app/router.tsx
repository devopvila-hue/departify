import { createBrowserRouter, Navigate } from "react-router-dom";

import { ChatRoute } from "@/routes/ChatRoute";
import { CompanyRoute } from "@/routes/CompanyRoute";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";
import { DecisionsRoute } from "@/routes/DecisionsRoute";
import { DepartmentsRoute } from "@/routes/DepartmentsRoute";
import { MarketingRoute } from "@/routes/MarketingRoute";
import { ResultsRoute } from "@/routes/ResultsRoute";
import { ShellGate } from "@/components/ShellGate";
import { TasksRoute } from "@/routes/TasksRoute";

/**
 * Sprint 59 information architecture.
 *
 *   /                    → onboarding (Customer Zero)
 *   /chat                → THE central conversation (the home)
 *   /tareas              → operational inbox of real work items
 *   /departamentos       → active + future departments
 *   /conexiones          → capability-first connection management
 *   /aprobaciones        → inbox of approvals (DecisionesRoute)
 *   /resultados          → historical archive of results
 *   /empresa             → Company DNA
 *   /configuracion       → advanced settings (placeholder)
 *   /inicio              → legacy alias for /chat (kept for back-compat)
 *   /marketing           → Marketing workspace (kept, no primary chat)
 *   /decisiones          → legacy alias for /aprobaciones
 */

export const router = createBrowserRouter([
  { path: "/", element: <CustomerZeroRoute /> },
  {
    element: <ShellGate />,
    children: [
      { path: "/chat", element: <ChatRoute /> },
      { path: "/tareas", element: <TasksRoute /> },
      { path: "/departamentos", element: <DepartmentsRoute /> },
      { path: "/conexiones", element: <ConnectionsRoute /> },
      { path: "/aprobaciones", element: <DecisionsRoute /> },
      { path: "/resultados", element: <ResultsRoute /> },
      { path: "/empresa", element: <CompanyRoute /> },
      { path: "/configuracion", element: <CompanyRoute /> },
      { path: "/inicio", element: <ChatRoute /> },
      { path: "/marketing", element: <MarketingRoute /> },
      { path: "/decisiones", element: <DecisionsRoute /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

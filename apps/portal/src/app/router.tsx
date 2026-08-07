import { createBrowserRouter, Navigate } from "react-router-dom";

import { CompanyRoute } from "@/routes/CompanyRoute";
import { ConnectionsRoute } from "@/routes/ConnectionsRoute";
import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";
import { DecisionsRoute } from "@/routes/DecisionsRoute";
import { HomeRoute } from "@/routes/HomeRoute";
import { MarketingRoute } from "@/routes/MarketingRoute";
import { ResultsRoute } from "@/routes/ResultsRoute";
import { ShellGate } from "@/components/ShellGate";

/**
 * "/" is the onboarding. Everything else lives inside the portal shell,
 * which requires a company: without one the CEO is sent back to onboarding.
 */
export const router = createBrowserRouter([
  { path: "/", element: <CustomerZeroRoute /> },
  {
    element: <ShellGate />,
    children: [
      { path: "/inicio", element: <HomeRoute /> },
      { path: "/marketing", element: <MarketingRoute /> },
      { path: "/decisiones", element: <DecisionsRoute /> },
      { path: "/resultados", element: <ResultsRoute /> },
      { path: "/conexiones", element: <ConnectionsRoute /> },
      { path: "/empresa", element: <CompanyRoute /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

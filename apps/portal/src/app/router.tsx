import { createBrowserRouter } from "react-router-dom";

import { FoundationRoute } from "@/routes/FoundationRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <FoundationRoute />,
  },
]);

import { createBrowserRouter } from "react-router-dom";

import { CustomerZeroRoute } from "@/routes/CustomerZeroRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <CustomerZeroRoute />,
  },
]);

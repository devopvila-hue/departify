import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider } from "@/app/auth-context";
import { OrgProvider } from "@/app/org-context";
import { portalQueryClient } from "@/app/query-client";

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <QueryClientProvider client={portalQueryClient}>
      <AuthProvider>
        <OrgProvider>{children}</OrgProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

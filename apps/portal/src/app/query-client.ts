import { QueryClient } from "@tanstack/react-query";

/**
 * One cache for the authenticated portal. Query keys always include the
 * organization id before any organization-owned resource so cached data
 * cannot be reused across companies.
 */
export const portalQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: { retry: 0 },
  },
});

export const portalQueryKeys = {
  org: (organizationId: string, resource: string, detail?: string) =>
    [
      "organization",
      organizationId,
      resource,
      ...(detail ? [detail] : []),
    ] as const,
};

export function clearPortalQueryCache(): void {
  portalQueryClient.clear();
}

export function invalidateOrganizationQueries(
  organizationId: string,
  resources?: readonly string[],
): Promise<void> {
  if (!resources || resources.length === 0) {
    return portalQueryClient.invalidateQueries({
      queryKey: ["organization", organizationId],
    });
  }
  return Promise.all(
    resources.map((resource) =>
      portalQueryClient.invalidateQueries({
        queryKey: ["organization", organizationId, resource],
      }),
    ),
  ).then(() => undefined);
}

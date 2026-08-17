import { describe, expect, it, vi } from "vitest";

import { api } from "@/app/api";
import {
  invalidateOrganizationQueries,
  portalQueryKeys,
} from "@/app/query-client";

describe("portal query cache", () => {
  it("keeps organization data isolated in query keys", () => {
    expect(portalQueryKeys.org("org-a", "overview")).not.toEqual(
      portalQueryKeys.org("org-b", "overview"),
    );
  });

  it("deduplicates concurrent organization reads and revalidates after invalidation", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ organizationId: "org-a" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([api.overview("org-a"), api.overview("org-a")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await api.overview("org-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await invalidateOrganizationQueries("org-a", ["overview"]);
    await api.overview("org-a");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

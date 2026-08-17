import "@testing-library/jest-dom/vitest";

import { clearPortalQueryCache } from "@/app/query-client";

// jsdom provides localStorage; ensure a clean store per test.
beforeEach(() => {
  window.localStorage.clear();
  clearPortalQueryCache();
});

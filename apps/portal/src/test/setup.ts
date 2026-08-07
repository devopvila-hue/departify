import "@testing-library/jest-dom/vitest";

// jsdom provides localStorage; ensure a clean store per test.
beforeEach(() => {
  window.localStorage.clear();
});

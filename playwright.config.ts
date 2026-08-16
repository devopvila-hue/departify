import { defineConfig, devices } from "@playwright/test";

export const productionUrl = "https://app.departify.app";
export const authStatePath = "e2e/.auth/production.json";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "golden-department.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "/tmp/departify-e2e-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "/tmp/departify-e2e-report", open: "never" }],
  ],
  use: {
    baseURL: productionUrl,
    storageState: authStatePath,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
});

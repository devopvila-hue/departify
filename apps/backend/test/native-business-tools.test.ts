import { describe, expect, it } from "vitest";
import { buildRuntimeCapabilityManifest } from "../src/customer-zero/capability-manifest.js";
import { nativeToolsForManifest } from "../src/customer-zero/native-business-tools.js";

describe("native business read surface", () => {
  it("exposes only verified capabilities and keeps mutations out", () => {
    const manifest = buildRuntimeCapabilityManifest([
      {
        toolId: "gmail",
        label: "Business mailbox",
        state: "connected",
        capabilities: ["email.read", "email.search"],
      },
      {
        toolId: "google_calendar",
        label: "Calendar",
        state: "connected",
        capabilities: ["calendar.read"],
      },
      {
        toolId: "google_drive",
        label: "Drive",
        state: "connected",
        capabilities: ["drive.search"],
      },
    ]);
    expect(nativeToolsForManifest(manifest)).toEqual([
      "departify.company.context",
      "departify.email.list",
      "departify.email.search",
      "departify.calendar.list",
      "departify.drive.search",
      "departify.tasks.list",
      "departify.approvals.list",
      "departify.results.list",
    ]);
    expect(nativeToolsForManifest(manifest).some((name) => /send|reply|create|write/.test(name))).toBe(false);
  });

  it("keeps Drive search independently available from Drive read", () => {
    const manifest = buildRuntimeCapabilityManifest([{
      toolId: "google_drive",
      label: "Drive",
      state: "connected",
      capabilities: ["drive.search"],
    }]);
    const tools = nativeToolsForManifest(manifest);
    expect(tools).toContain("departify.drive.search");
    expect(tools).not.toContain("departify.drive.read");
  });
});

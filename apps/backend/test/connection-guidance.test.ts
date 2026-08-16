import { describe, expect, it } from "vitest";

import { CONNECTION_DEFINITIONS } from "../src/customer-zero/connections-domain.js";
import { humanizeMarketingConnectorError } from "../src/customer-zero/marketing-connector.js";

const officialHosts = new Set(["developer.wordpress.org", "shopify.dev", "help.shopify.com"]);

describe("guided connection metadata", () => {
  it("declares the real WordPress manual fields and official guide", () => {
    const definition = CONNECTION_DEFINITIONS.find((entry) => entry.id === "wordpress");
    expect(definition?.connectionMethod).toBe("manual");
    expect(definition?.credentialHelp?.fields.map((field) => field.id)).toEqual([
      "websiteUrl", "username", "password",
    ]);
    expect(definition?.credentialHelp?.actionUrl).toBe(
      "https://developer.wordpress.org/advanced-administration/security/application-passwords/",
    );
  });

  it("declares Shopify as legacy-compatible manual setup without pretending new app tokens exist", () => {
    const definition = CONNECTION_DEFINITIONS.find((entry) => entry.id === "shopify");
    expect(definition?.connectionMethod).toBe("manual");
    expect(definition?.credentialHelp?.fields.map((field) => field.id)).toEqual(["shopName", "adminToken"]);
    expect(definition?.credentialHelp?.note).toMatch(/Dev Dashboard/);
    expect(definition?.credentialHelp?.actionUrl).toBe(
      "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin",
    );
  });

  it("does not expose a manual guide for OAuth or platform-owned providers", () => {
    expect(CONNECTION_DEFINITIONS.find((entry) => entry.id === "github_repository"))
      .toMatchObject({ connectionMethod: "oauth" });
    expect(CONNECTION_DEFINITIONS.find((entry) => entry.id === "mautic"))
      .toMatchObject({ connectionMethod: "platform_managed" });
    expect(CONNECTION_DEFINITIONS.find((entry) => entry.id === "github_repository")?.credentialHelp).toBeUndefined();
    expect(CONNECTION_DEFINITIONS.find((entry) => entry.id === "mautic")?.credentialHelp).toBeUndefined();
  });

  it("keeps all registry links HTTPS and on the approved official hosts", () => {
    for (const definition of CONNECTION_DEFINITIONS) {
      const help = definition.credentialHelp;
      if (!help) continue;
      for (const link of [help.actionUrl, help.docsUrl].filter(Boolean)) {
        const url = new URL(link!);
        expect(url.protocol).toBe("https:");
        expect(officialHosts.has(url.hostname)).toBe(true);
      }
    }
  });
});

describe("customer-safe connector errors", () => {
  it("humanizes authentication failures without leaking HTTP or provider details", () => {
    const message = humanizeMarketingConnectorError("shopify", "Provider returned HTTP 401: shpat-secret-token");
    expect(message).toMatch(/No hemos podido validar esta credencial/);
    expect(message).not.toContain("401");
    expect(message).not.toContain("shpat-secret-token");
  });

  it("keeps provider-specific guidance for WordPress", () => {
    expect(humanizeMarketingConnectorError("wordpress", "HTTP 403 forbidden")).toMatch(/contraseña de aplicación/);
  });
});

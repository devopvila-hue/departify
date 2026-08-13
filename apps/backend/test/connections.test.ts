import { describe, it, expect } from "vitest";
import {
  buildConnectionState,
  completeConnection,
  resolveTool,
  startConnection,
  TOOL_CATALOG,
} from "../src/customer-zero/connections.js";

describe("capability-first tool mapping", () => {
  it("maps what the CEO says to the internal connector and capability", () => {
    expect(resolveTool("Gmail")?.id).toBe("gmail");
    expect(resolveTool("Gmail")?.capability).toBe("email.send");
    expect(resolveTool("uso outlook todo el día")?.id).toBe("outlook");
    expect(resolveTool("HubSpot")?.capability).toBe("crm.contacts");
  });

  it("returns null for tools Departify has no capability for", () => {
    expect(resolveTool("Mi CRM interno de Excel")).toBeNull();
  });
});

describe("connection handshake", () => {
  const gmail = TOOL_CATALOG.find((tool) => tool.id === "gmail")!;

  it("starts as not connected", () => {
    expect(buildConnectionState(gmail, "es").status).toBe("not_connected");
    expect(buildConnectionState(gmail, "es").category).toBe("Correo");
    expect(buildConnectionState(gmail, "en").category).toBe("Email");
  });

  it("blocks honestly and reports the exact missing credential", () => {
    const connection = startConnection(
      buildConnectionState(gmail, "es"),
      gmail,
      { env: {}, redirectUri: "http://localhost:3000/cb" },
      "es",
    );
    expect(connection.status).toBe("blocked");
    expect(connection.missingCredentials).toEqual([
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
    ]);
    expect(connection.authorizationUrl).toBeUndefined();
  });

  it("produces a real provider authorization URL when credentials exist", () => {
    const connection = startConnection(
      buildConnectionState(gmail, "es"),
      gmail,
      {
        env: {
          GOOGLE_OAUTH_CLIENT_ID: "client-123",
          GOOGLE_OAUTH_CLIENT_SECRET: "secret",
        },
        redirectUri: "http://localhost:3000/cb",
      },
      "es",
    );
    expect(connection.status).toBe("connecting");
    expect(connection.authorizationUrl).toContain(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(connection.authorizationUrl).toContain("client_id=client-123");

    completeConnection(connection, new Date("2026-08-07T10:00:00Z"));
    expect(connection.status).toBe("connected");
    expect(connection.connectedAt).toBe("2026-08-07T10:00:00.000Z");
  });

  it.each([
    ["meta_business", ["META_APP_ID", "META_APP_SECRET"]],
    ["ticktick", ["TICKTICK_CLIENT_ID", "TICKTICK_CLIENT_SECRET"]],
  ] as const)("never fabricates a connection for %s", (toolId, credentials) => {
    const tool = TOOL_CATALOG.find((entry) => entry.id === toolId)!;
    const connection = startConnection(
      buildConnectionState(tool, "es"),
      tool,
      { env: Object.fromEntries(credentials.map((key) => [key, "configured"])), redirectUri: "http://localhost:3000/cb" },
      "es",
    );
    expect(connection.status).toBe("blocked");
    expect(connection.authorizationUrl).toBeUndefined();
    expect(connection.missingCredentials).toEqual(credentials);
  });

  it("keeps YouTube OAuth read-only while exposing preparation as a non-publish capability", () => {
    const youtube = TOOL_CATALOG.find((tool) => tool.id === "youtube")!;
    expect(youtube.scopes).toEqual(["https://www.googleapis.com/auth/youtube.readonly"]);
    expect(youtube.capability).toBe("marketing.video");
  });
});

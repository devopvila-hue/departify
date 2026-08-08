/**
 * P0-A — backend security boundary regression tests.
 *
 * The exact cases from the block:
 *   1. protected endpoint without Authorization → 401
 *   2. malformed/unknown token → 401
 *   3. valid user + own organization → success
 *   4. valid user + foreign organization → 403
 *   5. valid user + nonexistent organization → safe denial (403)
 *   6. organization creation automatically establishes owner membership
 *   7. (portal) authenticated API requests carry the token — portal test
 *   8. (portal) logout clears the token — portal test
 *
 * All deterministic — no real Supabase required.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { FakeTenantService } from "./helpers/fake-tenant.js";

const AUTH_A = "Bearer token-a";
const AUTH_B = "Bearer token-b";

describe("P0-A — backend security boundary", () => {
  let server: FastifyInstance;
  let tenant: FakeTenantService;

  beforeAll(async () => {
    tenant = new FakeTenantService({
      users: [
        ["token-a", { id: "user-a", email: "a@example.com" }],
        ["token-b", { id: "user-b", email: "b@example.com" }],
      ],
    });
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
    });
  });

  it("1. protected endpoint without Authorization → 401", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/customer-zero/org-a",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).toBe("Authentication failed.");
  });

  it("2. malformed/unknown token → 401", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/customer-zero/org-a",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("2b. non-Bearer Authorization header → 401", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/customer-zero/org-a",
      headers: { authorization: "Basic abc" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("3. valid user + own organization → success", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: AUTH_A },
      payload: {
        companyName: "Org A",
        hasWebsite: false,
        description: "Una empresa real.",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;

    const status = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}`,
      headers: { authorization: AUTH_A },
    });
    expect(status.statusCode).toBe(200);
  });

  it("4. valid user + foreign organization → 403", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: AUTH_A },
      payload: {
        companyName: "Org A-foreign",
        hasWebsite: false,
        description: "Solo del usuario A.",
      },
    });
    const organizationId = start.json().organizationId as string;

    const response = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}`,
      headers: { authorization: AUTH_B },
    });
    expect(response.statusCode).toBe(403);
  });

  it("5. valid user + nonexistent organization → safe denial (403)", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/customer-zero/org_does_not_exist",
      headers: { authorization: AUTH_A },
    });
    expect(response.statusCode).toBe(403);
  });

  it("403 responses are generic and never leak organization existence", async () => {
    const foreign = await server.inject({
      method: "GET",
      url: "/api/customer-zero/org-a",
      headers: { authorization: AUTH_B },
    });
    const missing = await server.inject({
      method: "GET",
      url: "/api/customer-zero/definitely-not-an-org",
      headers: { authorization: AUTH_B },
    });
    expect(foreign.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(foreign.json().error.message).toBe("Not authorized.");
    expect(missing.json().error.message).toBe("Not authorized.");
    expect(foreign.json().error).not.toHaveProperty("organizationId");
  });

  it("6. organization creation establishes owner membership", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/api/auth/organizations",
      headers: { authorization: AUTH_B },
      payload: { name: "Org B" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { organizationId: string; name: string; role: string };
    expect(body.role).toBe("owner");
    expect(body.name).toBe("Org B");

    const membership = tenant
      .membershipsOf("user-b")
      .find((entry) => entry.organizationId === body.organizationId);
    expect(membership?.role).toBe("owner");

    // The other user cannot touch the new organization.
    const forbidden = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${body.organizationId}`,
      headers: { authorization: AUTH_A },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it("GET /api/auth/me returns the user and their organizations", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: AUTH_A },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      user: { id: string; email: string };
      organizations: { organizationId: string; role: string }[];
    };
    expect(body.user.id).toBe("user-a");
    expect(body.user.email).toBe("a@example.com");
    expect(body.organizations.length).toBeGreaterThan(0);
  });

  it("health and version remain public", async () => {
    expect((await server.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/version" })).statusCode).toBe(200);
  });
});

import { describe, it, expect, beforeAll } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";

/**
 * End-to-end route test of the Customer Zero UX v2 flow. No network and no
 * real inference are required: the website fetch / LLM interpretation degrade
 * gracefully and the deterministic discovery pipeline still runs, which is
 * exactly the behaviour we want to keep honest.
 *
 * P0-A: every request is made as user-a through the fake tenant boundary.
 */
describe("Customer Zero UX v2 routes", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
    });
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: {
        authorization: "Bearer token-a",
        ...(options.headers ?? {}),
      },
    });
  }

  it("rejects an unusable website with a human message", async () => {
    const response = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: { companyName: "Moon", hasWebsite: true, url: "no tengo web" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_URL");
  });

  it("accepts a URL without protocol and normalizes it", async () => {
    const response = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Moon Shared Living",
        hasWebsite: true,
        url: "moonsharedliving.com",
        country: "España",
        companySize: "1-10",
        goal: "Conseguir clientes",
        goalDetail: "Quiero conseguir los primeros 20 clientes en España.",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().url).toBe("https://moonsharedliving.com");
  });

  it("runs the no-website path from the founder's own description", async () => {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Nueva idea",
        hasWebsite: false,
        description:
          "Estoy creando una plataforma que ayuda a personas a encontrar " +
          "vivienda compartida compatible y segura.",
        goal: "Lanzar mi negocio",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;

    const progress = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/progress`,
    });
    expect(progress.statusCode).toBe(200);
    const stages = progress.json().stages as { id: string; label: string }[];
    expect(stages.map((stage) => stage.id)).toEqual([
      "fetch",
      "products",
      "audience",
      "presentation",
      "questions",
    ]);
    expect(stages[0]?.label).toBe("Leyendo lo que nos has contado");

    // No description → explicit, human error instead of a fake analysis.
    const missing = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: { companyName: "Sin nada", hasWebsite: false },
    });
    expect(missing.json().error.code).toBe("MISSING_DESCRIPTION");
  });

  it("asks one question at a time and connects tools in-conversation", async () => {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Conversación",
        hasWebsite: false,
        description: "Vendo formación online para equipos comerciales.",
        goal: "Conseguir clientes",
      },
    });
    const organizationId = start.json().organizationId as string;

    const first = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/next-question`,
    });
    expect(first.statusCode).toBe(200);
    const question = first.json().question as { id: string } | null;
    expect(question).not.toBeNull();

    // Tools question → Gmail + Otra.
    const toolsAnswer = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/answer`,
      payload: { questionId: "ops:tools", answers: ["Gmail", "Otra"] },
    });
    expect(toolsAnswer.statusCode).toBe(200);
    const connections = toolsAnswer.json().connections as {
      toolId: string;
      status: string;
    }[];
    expect(connections.some((c) => c.toolId === "gmail")).toBe(true);
    expect(toolsAnswer.json().question.id).toBe("ops:tool_other");

    // "Otra" → we ask which one; an unknown tool is recorded honestly.
    await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/answer`,
      payload: { questionId: "ops:tool_other", answer: "Un CRM propio" },
    });
    const unmapped = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/connections`,
    });
    expect(unmapped.json().unmappedTools).toContain("Un CRM propio");

    // CRM = no is a valid answer and does not block anything.
    const crm = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/answer`,
      payload: { questionId: "ops:crm", answer: "No utilizo CRM" },
    });
    expect(crm.statusCode).toBe(200);

    // Connection card CTA → real handshake; blocked without the credential.
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/connections/gmail/connect`,
    });
    expect(connect.statusCode).toBe(200);
    const connection = connect.json().connection as {
      status: string;
      missingCredentials?: string[];
      authorizationUrl?: string;
    };
    if (process.env.GOOGLE_OAUTH_CLIENT_ID) {
      expect(connection.status).toBe("connecting");
      expect(connection.authorizationUrl).toBeTruthy();
    } else {
      expect(connection.status).toBe("blocked");
      expect(connection.missingCredentials).toContain("GOOGLE_OAUTH_CLIENT_ID");
    }
  });

  it("restores objetivo, respuestas, herramientas y conexiones after a reload", async () => {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Persistencia",
        hasWebsite: false,
        description: "Vendo cursos de cocina online.",
        goal: "Vender más",
        goalDetail: "Duplicar las ventas en España",
      },
    });
    const organizationId = start.json().organizationId as string;

    await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/answer`,
      payload: { questionId: "ops:tools", answers: ["Gmail"] },
    });

    const status = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}`,
    });
    const body = status.json() as {
      onboarding: { goal: string };
      discoveryTranscript: { questionId: string }[];
      connections: { toolId: string; status: string }[];
      locale: string;
    };
    expect(body.locale).toBe("es");
    expect(body.onboarding.goal).toContain("Duplicar las ventas");
    expect(body.discoveryTranscript[0]?.questionId).toBe("ops:tools");
    expect(body.connections[0]?.toolId).toBe("gmail");
    expect(body.connections[0]?.status).toBe("not_connected");
  });

  it("hands off to Marketing carrying the CEO's initial goal", async () => {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Handoff",
        hasWebsite: false,
        description: "Alquilo habitaciones en pisos compartidos.",
        goal: "Conseguir clientes",
        goalDetail: "Conseguir los primeros 20 clientes en España",
      },
    });
    const organizationId = start.json().organizationId as string;
    const handoff = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/handoff`,
    });
    expect(handoff.statusCode).toBe(200);
    const body = handoff.json() as { message: string; goal: string };
    expect(body.goal).toContain("primeros 20 clientes");
    expect(body.message).toContain("tengo una imagen");
    expect(body.message).not.toContain("Discovery completed");
  });

  it("keeps the CEO's explicit company name as the source of truth", async () => {
    // The CEO's own company name must always win, even when the research
    // guesses a different one from the website or description. Regression for
    // the case where the LLM-derived companyName overwrote the explicit input.
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Panaderia Sol",
        hasWebsite: false,
        description:
          "Panaderia artesanal de masa madre con reparto local en Sevilla.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;

    const overview = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/overview`,
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().companyName).toBe("Panaderia Sol");
  });
});

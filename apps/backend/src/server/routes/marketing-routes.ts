import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../deps.js";
import { getCustomerZeroSession } from "../../customer-zero/customer-zero-session.js";
import { isEmailQuestion, processCeoMessage, requireSession } from "./customer-zero-v2.js";
import { resolveLocale, t, type SupportedLocale } from "../../customer-zero/locale.js";

/**
 * Marketing department API — Sprint ENGINE 03.
 *
 * Business-language surface for the CEO to see and steer the Marketing
 * department (Elvira). No OpenClaw, agent, session-key or tool terminology is
 * exposed. All conversation is routed through the MarketingService →
 * EngineAdapter → OpenClaw → Vertex.
 *
 * These endpoints are additive to the existing Customer Zero routes; they do
 * not replace the Command Center chat (which remains the CEO's single chat).
 */
export async function registerMarketingRoutes(
  server: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  if (!deps.marketing) return;

  const marketing = deps.marketing;
  const localeOf = (q: { locale?: string }): SupportedLocale =>
    resolveLocale(q.locale);

  // Department overview — what a CEO sees in <10s.
  server.get<{
    Params: { organizationId: string };
    Querystring: { locale?: string };
  }>("/api/departments/marketing/:organizationId", async (request) => {
    const { organizationId } = request.params;
    const locale = localeOf(request.query);
    const connectedTools = listConnectedToolIds(organizationId);
    return marketing.getDepartmentStatus(organizationId, connectedTools, locale);
  });

  // Objectives
  server.get<{ Params: { organizationId: string } }>(
    "/api/departments/marketing/:organizationId/objectives",
    async (request) => {
      const { organizationId } = request.params;
      return { objectives: await marketing.listObjectives(organizationId) };
    },
  );

  server.post<{
    Params: { organizationId: string };
    Body: {
      title: string;
      description: string;
      desiredOutcome: string;
      constraints?: string[];
      locale?: string;
    };
  }>("/api/departments/marketing/:organizationId/objectives", async (request, reply) => {
    const { organizationId } = request.params;
    const body = request.body;
    const locale = resolveLocale(body.locale);
    if (!body.title || !body.description || !body.desiredOutcome) {
      return reply.code(400).send({
        error: {
          code: "INVALID_OBJECTIVE",
          message: t(locale, "El objetivo necesita título, descripción y resultado deseado.", "The objective needs a title, description and desired outcome."),
        },
      });
    }
    const objective = await marketing.createObjective({
      organizationId,
      title: body.title,
      description: body.description,
      desiredOutcome: body.desiredOutcome,
      ...(body.constraints ? { constraints: body.constraints } : {}),
      locale,
    });
    return { objective };
  });

  // Talk to Elvira (Golden Path). The CEO sends a message; Elvira responds
  // with business context + objective + plan + any approval request.
  server.post<{
    Params: { organizationId: string };
    Body: { message: string; locale?: string };
  }>("/api/departments/marketing/:organizationId/message", async (request, reply) => {
    const { organizationId } = request.params;
    const body = request.body;
    const locale = resolveLocale(body.locale);
    if (!body.message || body.message.trim().length === 0) {
      return reply.code(400).send({
        error: {
          code: "EMPTY_MESSAGE",
          message: t(locale, "Escribe un mensaje para Elvira.", "Write a message to Elvira."),
        },
      });
    }
    // All Gmail reads use the canonical durable capability pipeline, even
    // when the request arrives from the legacy Marketing surface. This keeps
    // that surface from disagreeing with central chat after a new session or
    // backend restart.
    if (isEmailQuestion(body.message)) {
      const session = await requireSession(organizationId, deps);
      const result = await processCeoMessage(session, body.message);
      return { reply: result.reply, activity: [], approvals: [] };
    }
    const outcome = await marketing.talkToElvira({
      organizationId,
      message: body.message,
      locale,
    });
    return {
      reply: outcome.reply,
      activity: outcome.activity ?? [],
      approvals: outcome.approvals ?? [],
      objective: outcome.objective,
    };
  });

  // Activity
  server.get<{ Params: { organizationId: string } }>(
    "/api/departments/marketing/:organizationId/activity",
    async (request) => {
      const { organizationId } = request.params;
      return { activity: await marketing.listActivity(organizationId) };
    },
  );

  // Approvals
  server.get<{ Params: { organizationId: string } }>(
    "/api/departments/marketing/:organizationId/approvals",
    async (request) => {
      const { organizationId } = request.params;
      return { approvals: await marketing.listApprovals(organizationId) };
    },
  );

  server.post<{
    Params: { organizationId: string; approvalId: string };
    Body: { action: "approve" | "reject"; locale?: string };
  }>("/api/departments/marketing/:organizationId/approvals/:approvalId", async (request, reply) => {
    const { organizationId, approvalId } = request.params;
    const body = request.body;
    const locale = resolveLocale(body.locale);
    if (body.action !== "approve" && body.action !== "reject") {
      return reply.code(400).send({
        error: { code: "INVALID_ACTION", message: "Action must be approve or reject." },
      });
    }
    const approval = await marketing.decideApproval(
      organizationId,
      approvalId,
      body.action,
      locale,
    );
    if (!approval) {
      return reply.code(404).send({
        error: { code: "APPROVAL_NOT_FOUND", message: "Approval not found." },
      });
    }
    return { approval };
  });

  // Digital employees + connected tools
  server.get<{ Params: { organizationId: string } }>(
    "/api/departments/marketing/:organizationId/employees",
    async (request) => {
      const { organizationId } = request.params;
      return { employees: await marketing.getDigitalEmployees(organizationId) };
    },
  );

  server.get<{ Params: { organizationId: string } }>(
    "/api/departments/marketing/:organizationId/tools",
    async (request) => {
      const { organizationId } = request.params;
      const connected = listConnectedToolIds(organizationId);
      return { tools: await marketing.getConnectedTools(organizationId, connected) };
    },
  );
}

/** Honest connected-tool ids from the existing tool state/connections store. */
function listConnectedToolIds(organizationId: string): string[] {
  // The Customer Zero session holds the real connection state. When it is not
  // available (e.g. tests), we return an empty set so every tool is honest
  // "No conectado".
  const session = getSessionForToolState(organizationId);
  if (!session) return [];
  return [...session.state.connections.values()]
    .filter((c) => c.status === "connected" || c.lifecycle === "connected")
    .map((c) => c.toolId);
}

function getSessionForToolState(
  organizationId: string,
): { state: { connections: Map<string, { status: string; lifecycle?: string; toolId: string }> } } | null {
  return getCustomerZeroSession(organizationId);
}

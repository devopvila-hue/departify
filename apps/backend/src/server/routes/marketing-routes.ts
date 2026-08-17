import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../deps.js";
import {
  buildCeoRuntimeForRequest,
  buildCanonicalConnectionViews,
  buildMarketingOperationalActivity,
  createCeoTurnTrace,
  emitCeoTurnTrace,
  processCeoMessage,
  requireSession,
  workStoreForRoutes,
} from "./customer-zero-v2.js";
import { resolveLocale, t, type SupportedLocale } from "../../customer-zero/locale.js";

/**
 * Marketing department API — Sprint ENGINE 03.
 *
 * Business-language surface for the CEO to see and steer the Marketing
 * department (Elvira). No OpenClaw, agent, session-key or tool terminology is
 * exposed. Conversation messages use the canonical CEO conversation pipeline;
 * the department service remains the durable business-state projection.
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
    const operational = await loadMarketingOperationalState(
      organizationId,
      locale,
      deps,
    );
    return marketing.getDepartmentStatus(
      organizationId,
      operational.connections
        .filter((connection) => connection.state === "connected")
        .map((connection) => connection.toolId),
      locale,
      operational,
    );
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

  // Compatibility ingress only. The CEO has one canonical conversation; this
  // legacy URL must use the same durable turn pipeline as /chat and may not
  // create a separate MarketingService/OpenClaw conversation.
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
    const session = await requireSession(organizationId, deps);
    const correlationId = String(
      request.headers["x-departify-correlation-id"] ?? request.id,
    );
    const trace = createCeoTurnTrace(session, correlationId);
    const runtime = await buildCeoRuntimeForRequest(
      session,
      deps,
      body.message,
      trace,
      request.authUser?.id,
    );
    const result = await processCeoMessage(
      session,
      body.message,
      undefined,
      marketing,
      deps.engineRuntimePolicy,
      runtime,
      trace,
    );
    emitCeoTurnTrace(session, runtime?.trace ?? trace, result);
    return result;
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
      const locale = localeOf({});
      const operational = await loadMarketingOperationalState(
        organizationId,
        locale,
        deps,
      );
      const department = await marketing.getDepartmentStatus(
        organizationId,
        operational.connections
          .filter((connection) => connection.state === "connected")
          .map((connection) => connection.toolId),
        locale,
        operational,
      );
      return { tools: department.tools };
    },
  );
}

async function loadMarketingOperationalState(
  organizationId: string,
  locale: SupportedLocale,
  deps: ServerDeps,
) {
  const session = await requireSession(organizationId, deps);
  const [connections, tasks, results] = await Promise.all([
    buildCanonicalConnectionViews(session, locale, undefined, {
      probeExternal: false,
    }),
    workStoreForRoutes().listTasksForOrg(organizationId, 100),
    workStoreForRoutes().listResultsForOrg(organizationId, 50),
  ]);
  return {
    connections,
    tasks,
    results,
    activity: buildMarketingOperationalActivity(tasks, results),
  };
}

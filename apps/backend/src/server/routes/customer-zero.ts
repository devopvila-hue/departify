import {
  fetchAndExtractWebsite,
  interpretWebsite,
  buildRawDataFromInterpretation,
} from "../../customer-zero/web-analysis.js";
import {
  getCustomerZeroSession,
  getOrCreateCustomerZeroSession,
  hydrateSessionToolState,
  runDiscoveryForSession,
  runMarketingPreparationForSession,
  runMarketingPlanForSession,
  executeMarketingWorkItemForSession,
  approveMarketingWorkItemForSession,
} from "../../customer-zero/customer-zero-session.js";
import { isToolDiscoveryComplete } from "../../customer-zero/progressive-discovery.js";
import type { ServerDeps } from "../deps.js";
import { curateMandatoryQuestions } from "../../customer-zero/questions.js";
import { buildAnswersRawData } from "../../customer-zero/answers.js";
import type { FastifyInstance } from "fastify";
import type { DepartmentSnapshot } from "@departify/departments";
import type { CompanyDiscoveryReport } from "@departify/business-discovery";

/**
 * Customer Zero routes — the product surface that lets the CEO walk the full
 * vertical slice from the browser:
 *
 *   URL → "Conociendo tu negocio" → "Esto hemos entendido" → confirm/correct
 *   → gaps/preguntas → Company DNA → preparar Marketing → conversación.
 *
 * The routes are thin adapters. All analysis and conversation work happens in
 * the composed runtime; nothing is simulated.
 */
export async function registerCustomerZeroRoutes(
  server: FastifyInstance,
  deps: ServerDeps = {},
): Promise<void> {
  server.post(
    "/api/customer-zero/analyze",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Investigate a real company from its website URL",
        body: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "url", "understood", "gaps", "questions"],
            properties: {
              organizationId: { type: "string" },
              url: { type: "string" },
              understood: { type: "object", additionalProperties: true },
              gaps: { type: "array" },
              questions: { type: "array" },
              mandatoryQuestions: { type: "array" },
              companyDna: { type: "object", additionalProperties: true },
              gapCount: { type: "number" },
            },
          },
          502: {
            type: "object",
            required: ["error"],
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { url } = request.body as { url: string };
      const organizationId = `org_${slugify(url)}_${shortId()}`;

      try {
        const session = getOrCreateCustomerZeroSession(organizationId, {
          ...(deps.toolState ? { toolState: deps.toolState } : {}),
          ...(deps.conversations ? { conversations: deps.conversations } : {}),
        });
        await hydrateSessionToolState(session);
        session.state.url = url;

        // 1. Real web investigation.
        const extracted = await fetchAndExtractWebsite(url);

        // 2. Real interpretation with the LLM.
        const interpreted = await interpretWebsite(extracted, session.llm.router);

        // 3. Feed the discovered facts into the DNA-shaped rawData.
        const rawData = buildRawDataFromInterpretation(interpreted);
        session.state.rawData = rawData;
        session.state.companyName =
          interpreted.companyName ?? extracted.title ?? url;

        // 4. Run the existing discovery pipeline on the real company data.
        const report = await runDiscoveryForSession(session);

        return reply.code(200).send({
          organizationId,
          url,
          understood: interpreted,
          gaps: report.gaps,
          questions: report.questions,
          mandatoryQuestions: curateMandatoryQuestions(report),
          companyDna: report.companyDna,
          gapCount: report.gaps.length,
        });
      } catch (cause) {
        return reply.code(502).send({
          error: {
            code: "WEB_ANALYSIS_FAILED",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      }
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/questions",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Mandatory questions derived from the real discovery gaps",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "questions"],
            properties: {
              organizationId: { type: "string" },
              questions: { type: "array" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }
      const mostRecent = mostRecentReport(session);
      return reply.code(200).send({
        organizationId,
        questions: mostRecent ? curateMandatoryQuestions(mostRecent) : [],
      });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/answers",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Persist the CEO's answers into the Company DNA",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["answers"],
          properties: {
            answers: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "gaps", "questions", "companyDna"],
            properties: {
              organizationId: { type: "string" },
              gaps: { type: "array" },
              questions: { type: "array" },
              mandatoryQuestions: { type: "array" },
              companyDna: { type: "object", additionalProperties: true },
              gapCount: { type: "number" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const { answers } = request.body as {
        answers: Readonly<Record<string, unknown>>;
      };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      // Persist the CEO's answers into the Company DNA. Explicit user input
      // prevails over website inferences.
      session.state.rawData = {
        ...session.state.rawData,
        ...buildAnswersRawData(answers),
      };

      const report = await runDiscoveryForSession(session);
      return reply.code(200).send({
        organizationId,
        gaps: report.gaps,
        questions: report.questions,
        mandatoryQuestions: curateMandatoryQuestions(report),
        companyDna: report.companyDna,
        gapCount: report.gaps.length,
      });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/marketing",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Prepare the Marketing department with the learned context",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: [
              "organizationId",
              "department",
              "firstResult",
              "gaps",
              "questions",
            ],
            properties: {
              organizationId: { type: "string" },
              department: { type: "object", additionalProperties: true },
              firstResult: { type: ["object", "null"], additionalProperties: true },
              gaps: { type: "array" },
              questions: { type: "array" },
              error: { type: ["object", "null"], additionalProperties: true },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: {
            type: "object",
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                  statusCode: { type: "number" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      // Phase P-B — one authoritative path: onboarding may NOT reach the
      // department handoff before capability/tool discovery is complete.
      if (!isToolDiscoveryComplete(session.state.discovery)) {
        return reply.code(409).send({
          error: {
            code: "DISCOVERY_INCOMPLETE",
            message:
              "Todavía no hemos terminado de conocer las herramientas que utiliza la empresa.",
            requestId: request.id,
            statusCode: 409,
          },
        });
      }

      // Idempotent handoff: if the department already exists, do not
      // re-provision it (no contradictory state).
      const alreadyProvisioned = findMarketingDepartment(session);
      if (alreadyProvisioned) {
        return reply.code(200).send({
          organizationId,
          department: alreadyProvisioned,
          firstResult: null,
          gaps: [],
          questions: [],
          error: null,
        });
      }

      const { result, workflowResult } =
        await runMarketingPreparationForSession(session);
      const department = findMarketingDepartment(session);

      if (result.status !== "completed") {
        return reply.code(200).send({
          organizationId,
          department,
          firstResult: null,
          gaps: [],
          questions: [],
          error: result.errors[0]
            ? { code: result.errors[0].code, message: result.errors[0].message }
            : { code: "PREPARATION_FAILED", message: "Preparation failed." },
        });
      }

      return reply.code(200).send({
        organizationId,
        department,
        firstResult: workflowResult?.finalOutput ?? null,
        gaps: [],
        questions: [],
        error: null,
      });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/marketing",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "The Marketing department surface with its real configuration",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "department"],
            properties: {
              organizationId: { type: "string" },
              department: { type: ["object", "null"], additionalProperties: true },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }
      return reply.code(200).send({
        organizationId,
        department: findMarketingDepartment(session),
      });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/marketing/messages",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Talk with the Marketing Director using the real business context",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "reply"],
            properties: {
              organizationId: { type: "string" },
              reply: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          502: {
            type: "object",
            required: ["error"],
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const { message } = request.body as { message: string };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      try {
        // Execute the marketing.chat tool as the Marketing Director through
        // the real runtime (AgentToolBridge → Tool Runtime → Core Tool
        // Catalog → LLM Router → provider).
        const outcome = await session.port.executeAction({
          actionId: `act_chat_${shortId()}`,
          agentId: "agent_marketing_director",
          organizationId,
          toolId: "marketing.chat",
          args: {
            organizationId,
            message,
            history: session.state.conversation,
          },
        });

        if (outcome.status === "rejected") {
          return reply.code(502).send({
            error: { code: outcome.code, message: outcome.reason },
          });
        }
        if (outcome.status === "failed") {
          return reply.code(502).send({
            error: {
              code: outcome.error?.code ?? "MARKETING_CHAT_FAILED",
              message: outcome.error?.message ?? "Marketing chat failed.",
            },
          });
        }

        const output = outcome.output as { reply?: string } | undefined;
        const replyText = output?.reply ?? "El Director de Marketing no respondió.";

        session.state.conversation = [
          ...session.state.conversation,
          { role: "user", content: message },
          { role: "assistant", content: replyText },
        ];

        return reply.code(200).send({ organizationId, reply: replyText });
      } catch (cause) {
        return reply.code(502).send({
          error: {
            code: "MARKETING_CHAT_FAILED",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      }
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/marketing/work",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Give Marketing a business goal; it creates a structured work plan",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["goal"],
          properties: {
            goal: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "summary", "items"],
            properties: {
              organizationId: { type: "string" },
              summary: { type: "string" },
              items: { type: "array" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          502: {
            type: "object",
            required: ["error"],
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const { goal } = request.body as { goal: string };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      try {
        const plan = await runMarketingPlanForSession(session, goal);
        return reply.code(200).send({
          organizationId,
          summary: plan.summary,
          items: plan.items,
        });
      } catch (cause) {
        return reply.code(502).send({
          error: {
            code: "MARKETING_PLAN_FAILED",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      }
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/marketing/work/:itemId/execute",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Execute a Marketing work item that is really executable",
        params: {
          type: "object",
          required: ["organizationId", "itemId"],
          properties: {
            organizationId: { type: "string" },
            itemId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "itemId", "status", "result"],
            properties: {
              organizationId: { type: "string" },
              itemId: { type: "string" },
              status: { type: "string" },
              result: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          502: {
            type: "object",
            required: ["error"],
            properties: {
              error: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, itemId } = request.params as {
        organizationId: string;
        itemId: string;
      };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      try {
        const result = await executeMarketingWorkItemForSession(session, itemId);
        const item = session.state.marketingWork?.items.find((i) => i.id === itemId);
        return reply.code(200).send({
          organizationId,
          itemId,
          status: item?.status ?? "unknown",
          result,
        });
      } catch (cause) {
        return reply.code(502).send({
          error: {
            code: "MARKETING_EXECUTE_FAILED",
            message: cause instanceof Error ? cause.message : String(cause),
          },
        });
      }
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/marketing/work/:itemId/approve",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "CEO approves a gated Marketing action",
        params: {
          type: "object",
          required: ["organizationId", "itemId"],
          properties: {
            organizationId: { type: "string" },
            itemId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "itemId", "status", "result"],
            properties: {
              organizationId: { type: "string" },
              itemId: { type: "string" },
              status: { type: "string" },
              result: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, itemId } = request.params as {
        organizationId: string;
        itemId: string;
      };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      try {
        const item = approveMarketingWorkItemForSession(session, itemId);
        return reply.code(200).send({
          organizationId,
          itemId,
          status: item.status,
          result: item.result ?? "",
        });
      } catch (cause) {
        return reply.code(404).send({
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
  );

  server.get(
    "/api/customer-zero/:organizationId",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Current Customer Zero status (used to resume after reload)",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId"],
            properties: {
              organizationId: { type: "string" },
              url: { type: "string" },
              companyName: { type: "string" },
              gapCount: { type: "number" },
              mandatoryQuestions: { type: "array" },
              locale: { type: "string" },
              onboarding: { type: "object", additionalProperties: true },
              discoveryTranscript: { type: "array" },
              connections: { type: "array" },
              unmappedTools: { type: "array" },
              department: { type: ["object", "null"], additionalProperties: true },
              marketingWork: { type: ["object", "null"], additionalProperties: true },
              conversation: { type: "array" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      const report = mostRecentReport(session);
      return reply.code(200).send({
        organizationId,
        ...(session.state.url ? { url: session.state.url } : {}),
        ...(session.state.companyName ? { companyName: session.state.companyName } : {}),
        gapCount: report?.gaps.length ?? 0,
        mandatoryQuestions: report ? curateMandatoryQuestions(report) : [],
        // UX v2 state so a reload restores objetivo, respuestas, herramientas
        // y estado de conexión, no solo el Departamento.
        locale: session.state.locale,
        ...(session.state.onboarding
          ? { onboarding: session.state.onboarding }
          : {}),
        discoveryTranscript: session.state.discoveryTranscript,
        connections: [...session.state.connections.values()],
        unmappedTools: session.state.unmappedTools,
        department: findMarketingDepartment(session),
        ...(session.state.marketingWork
          ? { marketingWork: session.state.marketingWork }
          : {}),
        conversation: session.state.conversation,
      });
    },
  );
}

function findMarketingDepartment(
  session: {
    departmentService: { list(): readonly DepartmentSnapshot[] };
    organizationId: string;
  },
): DepartmentSnapshot | null {
  return (
    session.departmentService
      .list()
      .find(
        (d) =>
          d.organizationId === session.organizationId && d.status !== "archived",
      ) ?? null
  );
}

function mostRecentReport(session: {
  reports: readonly CompanyDiscoveryReport[];
}): CompanyDiscoveryReport | null {
  const reports = [...session.reports].sort(
    (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime(),
  );
  return reports[0] ?? null;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "company";
}

function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

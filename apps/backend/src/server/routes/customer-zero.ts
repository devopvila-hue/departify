import {
  fetchAndExtractWebsite,
  interpretWebsite,
  buildRawDataFromInterpretation,
} from "../../customer-zero/web-analysis.js";
import {
  getCustomerZeroSession,
  getOrCreateCustomerZeroSession,
  runDiscoveryForSession,
  runMarketingPreparationForSession,
} from "../../customer-zero/customer-zero-session.js";
import type { FastifyInstance } from "fastify";
import type { DepartmentSnapshot } from "@departify/departments";

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
        const session = getOrCreateCustomerZeroSession(organizationId);
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

  server.post(
    "/api/customer-zero/:organizationId/correct",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Apply the CEO's corrections to the Company DNA",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: {
            organizationId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["corrections"],
          properties: {
            corrections: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "gaps", "questions"],
            properties: {
              organizationId: { type: "string" },
              gaps: { type: "array" },
              questions: { type: "array" },
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
      const { corrections } = request.body as {
        corrections: Readonly<Record<string, unknown>>;
      };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      // Merge the CEO's corrections over the discovered rawData using a
      // verified user_input source.
      session.state.rawData = {
        ...session.state.rawData,
        ...normaliseCorrections(corrections),
      };

      const report = await runDiscoveryForSession(session);
      return reply.code(200).send({
        organizationId,
        gaps: report.gaps,
        questions: report.questions,
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
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };

      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
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

/**
 * Wraps CEO corrections into the DNA-shaped shape the pipeline understands,
 * marking them as verified user input.
 */
function normaliseCorrections(
  corrections: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const confidence = {
    level: "verified",
    source: "user_input",
    lastVerified: new Date().toISOString(),
  };

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(corrections)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    switch (key) {
      case "mission":
        out.mission = { statement: trimmed, confidence };
        break;
      case "vision":
        out.vision = { statement: trimmed, confidence };
        break;
      case "market":
        out.market = {
          industry: trimmed,
          competition: "medium",
          confidence,
        };
        break;
      case "positioning":
        out.positioning = { statement: trimmed, differentiation: [], confidence };
        break;
      case "valueProposition":
        out.valueProposition = { statement: trimmed, differentiation: [], confidence };
        break;
      default:
        // Unknown corrections are ignored rather than injected blindly.
        break;
    }
  }
  return out;
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

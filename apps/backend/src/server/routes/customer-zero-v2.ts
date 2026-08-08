/**
 * Customer Zero UX v2 routes — the product surface a CEO actually wants to use.
 *
 *   intake (nombre + web o idea + país + tamaño + objetivo)
 *   → pantalla de investigación VIVA (etapas reales del pipeline)
 *   → discovery progresivo (una pregunta cada vez, componentes adecuados)
 *   → herramientas + connection cards en la conversación
 *   → transición natural a Marketing con TODO el contexto.
 *
 *   Sprint 58 adds the Command Center endpoints: the CEO's single chat lives
 *   at `/api/customer-zero/:organizationId/command-center/...` and the same
 *   `marketing.chat` tool from Core Tool Catalog answers through it.
 *
 * Thin adapters only: every analysis, question and deliverable comes from the
 * composed runtime. Nothing is simulated.
 */
import type { FastifyInstance } from "fastify";
import {
  fetchAndExtractWebsite,
  interpretWebsite,
  interpretDescription,
  buildRawDataFromInterpretation,
  type InterpretedBusiness,
} from "../../customer-zero/web-analysis.js";
import {
  getCustomerZeroSession,
  getOrCreateCustomerZeroSession,
  runDiscoveryForSession,
  produceDiagnosisForSession,
  produceTeamForSession,
  type CustomerZeroSession,
} from "../../customer-zero/customer-zero-session.js";
import { buildAnswersRawData } from "../../customer-zero/answers.js";
import {
  normalizeCompanyUrl,
  InvalidCompanyUrlError,
} from "../../customer-zero/url-normalization.js";
import { resolveLocale, t, type SupportedLocale } from "../../customer-zero/locale.js";
import {
  completeProgress,
  completeStage,
  createResearchProgress,
  estimatedTotalMs,
  failProgress,
  startStage,
} from "../../customer-zero/research-progress.js";
import {
  buildConnectionState,
  completeConnection,
  resolveTool,
  startConnection,
  TOOL_CATALOG,
  type ConnectionState,
} from "../../customer-zero/connections.js";
import {
  isReadyForMarketing,
  noCrmOptionLabel,
  otherOptionLabel,
  selectNextQuestion,
  type ProgressiveQuestion,
} from "../../customer-zero/progressive-discovery.js";
import { buildCeoOverview } from "../../customer-zero/ceo-overview.js";
import {
  buildHeadView,
  getMarketingHead,
} from "../../customer-zero/department-identity.js";
import {
  buildCommandCenterInput,
  buildProactiveOpening,
  routeCommandCenter,
  type CommandCenterEvent,
} from "../../customer-zero/command-center.js";
import {
  buildDnaRawDataFromSuggestion,
  listDepartmentMemory,
  rememberDepartment,
  type DepartmentMemoryKind,
  type DepartmentMemoryProvenance,
} from "../../customer-zero/department-memory.js";
import { buildSessionOperationalContext } from "../../customer-zero/operational-context.js";
import type { CompanyDiscoveryReport } from "@departify/business-discovery";
import type { ServerDeps } from "../deps.js";

export async function registerCustomerZeroV2Routes(
  server: FastifyInstance,
  deps: ServerDeps = {},
): Promise<void> {
  server.post(
    "/api/customer-zero/start",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Start onboarding: minimum high-value information only",
        body: {
          type: "object",
          required: ["companyName"],
          properties: {
            companyName: { type: "string", minLength: 1 },
            hasWebsite: { type: "boolean" },
            url: { type: "string" },
            description: { type: "string" },
            country: { type: "string" },
            companySize: { type: "string" },
            goal: { type: "string" },
            goalDetail: { type: "string" },
            locale: { type: "string" },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId"],
            properties: {
              organizationId: { type: "string" },
              url: { type: "string" },
              estimatedMs: { type: ["number", "null"] },
            },
          },
          400: {
            type: "object",
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
          500: {
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
          503: {
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
      const body = request.body as {
        companyName: string;
        hasWebsite?: boolean;
        url?: string;
        description?: string;
        country?: string;
        companySize?: string;
        goal?: string;
        goalDetail?: string;
        locale?: string;
      };
      const locale = resolveLocale(body.locale);
      const hasWebsite = body.hasWebsite ?? Boolean(body.url);

      let normalizedUrl: string | undefined;
      if (hasWebsite) {
        try {
          normalizedUrl = normalizeCompanyUrl(body.url ?? "").url;
        } catch (cause) {
          return reply.code(400).send({
            error: {
              code: "INVALID_URL",
              message:
                cause instanceof InvalidCompanyUrlError
                  ? t(
                      locale,
                      "Esa dirección web no parece válida. Ejemplo: miempresa.com",
                      "That website does not look valid. Example: mycompany.com",
                    )
                  : String(cause),
            },
          });
        }
      } else if (!body.description || body.description.trim().length === 0) {
        return reply.code(400).send({
          error: {
            code: "MISSING_DESCRIPTION",
            message: t(
              locale,
              "Cuéntanos qué estás creando para que podamos entenderlo.",
              "Tell us what you are building so we can understand it.",
            ),
          },
        });
      }

      // P0-A — the organization must be a real, durable tenant record owned
      // by the authenticated user. The verified user id comes from the
      // request token (never from the browser). Organization creation is
      // atomic (organization + owner membership) through the store.
      const ownerId = request.authUser?.id;
      if (!ownerId || !deps.organizations) {
        return reply.code(503).send({
          error: {
            code: "AUTH_UNAVAILABLE",
            message: "Authentication is not configured.",
            requestId: request.id,
            statusCode: 503,
          },
        });
      }
      let organizationId: string;
      try {
        const organization = await deps.organizations.createOrganization(
          body.companyName.trim(),
          ownerId,
        );
        organizationId = organization.organizationId;
      } catch (cause) {
        request.log.error({ error: cause }, "Organization creation failed");
        return reply.code(500).send({
          error: {
            code: "ORGANIZATION_CREATION_FAILED",
            message: "Could not create the organization.",
            requestId: request.id,
            statusCode: 500,
          },
        });
      }
      const session = getOrCreateCustomerZeroSession(organizationId, { locale });
      session.state.locale = locale;
      session.state.companyName = body.companyName;
      if (normalizedUrl) {
        session.state.url = normalizedUrl;
      }
      // The CEO's own words win; the quick option is the fallback.
      const goal =
        (body.goalDetail ?? "").trim() || (body.goal ?? "").trim();
      session.state.onboarding = {
        companyName: body.companyName,
        hasWebsite,
        ...(normalizedUrl ? { url: normalizedUrl } : {}),
        ...(body.description ? { description: body.description.trim() } : {}),
        ...(body.country ? { country: body.country } : {}),
        ...(body.companySize ? { companySize: body.companySize } : {}),
        goal,
      };
      session.state.progress = createResearchProgress(
        locale,
        hasWebsite ? "website" : "description",
      );

      // The research runs in the background: the UI follows the REAL stages.
      void runResearch(session, locale).catch(() => {
        /* progress already carries the failure */
      });

      return reply.code(200).send({
        organizationId,
        ...(normalizedUrl ? { url: normalizedUrl } : {}),
        estimatedMs: estimatedTotalMs(),
      });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/progress",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Real research progress for the 'Conociendo tu negocio' screen",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const session = getCustomerZeroSession(organizationId);
      if (!session?.state.progress) {
        return reply.code(404).send({ error: "Session not found." });
      }
      const progress = session.state.progress;
      const report = mostRecentReport(session);
      return reply.code(200).send({
        organizationId,
        status: progress.status,
        stages: progress.stages,
        estimatedMs: estimatedTotalMs(),
        ...(progress.error ? { error: progress.error } : {}),
        ...(report ? { gapCount: report.gaps.length } : {}),
        understood: session.state.understood ?? {},
      });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/next-question",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "The single next highest-value question (progressive discovery)",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
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
      return reply.code(200).send(buildConversationPayload(session));
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/answer",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Answer one question; DNA is updated and gaps are recomputed",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["questionId"],
          properties: {
            questionId: { type: "string", minLength: 1 },
            answer: { type: "string" },
            answers: { type: "array", items: { type: "string" } },
          },
          additionalProperties: false,
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const body = request.body as {
        questionId: string;
        answer?: string;
        answers?: string[];
      };
      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }

      const locale = session.state.locale;
      const values = (body.answers ?? (body.answer ? [body.answer] : []))
        .map((value) => value.trim())
        .filter(Boolean);
      const gapsBefore = mostRecentReport(session)?.gaps.length ?? 0;

      const question = currentQuestion(session);
      const questionText = question?.question ?? body.questionId;

      if (body.questionId.startsWith("dna:") && values.length > 0) {
        const category = body.questionId.slice(4);
        session.state.rawData = {
          ...session.state.rawData,
          ...buildAnswersRawData({ [category]: values.join(", ") }),
        };
        session.state.discovery.dnaAsked += 1;
        // Recompute the REAL gaps: one answer can close several of them.
        await runDiscoveryForSession(session);
      } else if (
        body.questionId === "ops:tools" ||
        body.questionId === "ops:crm" ||
        body.questionId === "ops:tool_other"
      ) {
        registerTools(session, values, locale);
      }

      session.state.discovery.answered.add(body.questionId);
      if (values.length > 0) {
        session.state.discoveryTranscript.push({
          questionId: body.questionId,
          question: questionText,
          answer: values.join(", "),
        });
      }

      const gapsAfter = mostRecentReport(session)?.gaps.length ?? gapsBefore;
      return reply.code(200).send({
        ...buildConversationPayload(session),
        gapsBefore,
        gapsAfter,
        gapsResolved: Math.max(0, gapsBefore - gapsAfter),
      });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/connections",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Connection cards for the tools the company uses",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
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
        connections: [...session.state.connections.values()],
        unmappedTools: session.state.unmappedTools,
      });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/connections/:toolId/connect",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Start the REAL OAuth handshake for a tool, in-conversation",
        params: {
          type: "object",
          required: ["organizationId", "toolId"],
          properties: {
            organizationId: { type: "string" },
            toolId: { type: "string" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, toolId } = request.params as {
        organizationId: string;
        toolId: string;
      };
      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }
      const tool = TOOL_CATALOG.find((entry) => entry.id === toolId);
      if (!tool) {
        return reply.code(404).send({ error: "Tool not found." });
      }
      const connection =
        session.state.connections.get(tool.id) ??
        buildConnectionState(tool, session.state.locale);
      session.state.connections.set(tool.id, connection);

      // Sprint 61 — Mautic uses API key auth (not OAuth). Validate
      // credentials through the canonical Tool Runtime.
      if (tool.id === "mautic") {
        const connIsEs = session.state.locale !== "en";
        const env = process.env;
        const baseUrl = env["MAUTIC_BASE_URL"]?.trim();
        const clientId = env["MAUTIC_CLIENT_ID"]?.trim();
        const clientSecret = env["MAUTIC_CLIENT_SECRET"]?.trim();

        if (!baseUrl || !clientId || !clientSecret) {
          connection.status = "blocked";
          connection.blockedReason = connIsEs
            ? `Faltan las credenciales para conectar Mautic: MAUTIC_BASE_URL, MAUTIC_CLIENT_ID o MAUTIC_CLIENT_SECRET.`
            : `Missing credentials to connect Mautic: MAUTIC_BASE_URL, MAUTIC_CLIENT_ID, or MAUTIC_CLIENT_SECRET.`;
          connection.missingCredentials = ["MAUTIC_BASE_URL", "MAUTIC_CLIENT_ID", "MAUTIC_CLIENT_SECRET"].filter(
            (key) => !env[key]?.trim(),
          );
          return reply.code(200).send({ organizationId, connection });
        }

        connection.status = "connecting";
        try {
          const outcome = await session.port.executeAction({
            actionId: `act_mtc_connect_${shortId()}`,
            agentId: "agent_marketing_director",
            organizationId,
            toolId: "mautic.test_connection",
            args: {},
          });

          if (
            outcome.status === "completed" &&
            (outcome.output as { success?: boolean })?.success
          ) {
            completeConnection(connection);
            // Sprint 62 — a verified real connection certifies the capability.
            // The registry still requires the operational source (connection +
            // tools) to report connected before it presents READY.
            const { certifyMauticCapability } = await import(
              "@departify/capability-engine"
            );
            const current =
              session.capabilities.get("mautic") ??
              (await import("@departify/capability-engine")).buildMauticCapability();
            session.capabilities.register(
              certifyMauticCapability(current, new Date().toISOString()),
            );
          } else {
            const msg =
              (outcome as { output?: { message?: string } })?.output
                ?.message ?? "Connection test failed.";
            connection.status = "blocked";
            connection.blockedReason = connIsEs
              ? `No se pudo validar la conexión con Mautic: ${msg}`
              : `Could not validate Mautic connection: ${msg}`;
          }
        } catch (cause) {
          connection.status = "blocked";
          connection.blockedReason = connIsEs
            ? `Error al conectar con Mautic: ${cause instanceof Error ? cause.message : "Error desconocido"}`
            : `Error connecting to Mautic: ${cause instanceof Error ? cause.message : "Unknown error"}`;
        }
        return reply.code(200).send({ organizationId, connection });
      }

      startConnection(
        connection,
        tool,
        {
          env: process.env,
          redirectUri: `${deps.publicBaseUrl ?? publicBaseUrl()}/api/customer-zero/${organizationId}/connections/${tool.id}/callback`,
        },
        session.state.locale,
      );

      return reply.code(200).send({ organizationId, connection });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/connections/:toolId/callback",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Finish a real OAuth handshake with the provider's code",
        params: {
          type: "object",
          required: ["organizationId", "toolId"],
          properties: {
            organizationId: { type: "string" },
            toolId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, toolId } = request.params as {
        organizationId: string;
        toolId: string;
      };
      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }
      const connection = session.state.connections.get(toolId);
      if (!connection) {
        return reply.code(404).send({ error: "Connection not started." });
      }
      if (connection.status !== "connecting") {
        return reply.code(409).send({
          organizationId,
          connection,
          error: {
            code: "HANDSHAKE_NOT_STARTED",
            message:
              connection.blockedReason ??
              "The handshake was never started for this tool.",
          },
        });
      }
      completeConnection(connection);
      return reply.code(200).send({ organizationId, connection });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/handoff",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Marketing's first message — continuity, not 'discovery completed'",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
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
        message: buildHandoffMessage(session),
        goal: session.state.onboarding?.goal ?? "",
        head: buildHeadView(getMarketingHead(), session.state.locale),
        connections: [...session.state.connections.values()],
        diagnosis: session.state.marketingDiagnosis ?? null,
        team: session.state.marketingTeam ?? null,
      });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/overview",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "The CEO's business view: decisions, activity and results",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
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
        ...buildCeoOverview(session),
      });
    },
  );

  /* -------------------------------------------------------------------------
   * Command Center (Sprint 58) — the CEO's single chat surface.
   *
   * The portal's Home (called "Dirección") hosts the Command Center. Three
   * endpoints:
   *
   *   GET  /:organizationId/command-center/opening
   *     → proactive opening events to render BEFORE the CEO types anything.
   *
   *   POST /:organizationId/command-center/message
   *     → route a CEO message. Returns the reply + structured events.
   *       When the routing decision is `delegate_marketing` we also call
   *       the existing `marketing.chat` tool through the AgentToolBridge so
   *       the Marketing Director's own reasoning is preserved.
   *
   *   POST /:organizationId/command-center/ask
   *     → "Preguntar sobre esto" from the Marketing workspace. Composes a
   *       contextual message carrying the work item / department surface
   *       reference and routes it through the Command Center.
   *
   * The transcript is the same `session.state.conversation` array the
   * Customer Zero flow already uses. The events are returned separately so
   * the portal can render them as cards without polluting the transcript.
   * -------------------------------------------------------------------------*/

  server.get(
    "/api/customer-zero/:organizationId/command-center/opening",
    {
      schema: {
        tags: ["command-center"],
        summary: "Proactive opening events for the CEO Command Center",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "events"],
            properties: {
              organizationId: { type: "string" },
              events: { type: "array" },
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
      const events = buildProactiveOpening(session);
      return reply.code(200).send({ organizationId, events });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/command-center/message",
    {
      schema: {
        tags: ["command-center"],
        summary: "Route a CEO message through the Command Center",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
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
            required: ["organizationId", "reply", "events", "routing"],
            properties: {
              organizationId: { type: "string" },
              reply: { type: "string" },
              events: { type: "array" },
              routing: { type: "object", additionalProperties: true },
              connectionSuggestion: {
                type: ["object", "null"],
                additionalProperties: true,
              },
              pendingToolId: { type: ["string", "null"] },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
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

      const input = buildCommandCenterInput(session, message);
      const routed = routeCommandCenter(input);

      const isEs = session.state.locale !== "en";
      let assistantReply = routed.reply;
      let marketingTurn: { role: "user" | "assistant"; content: string } | null = null;

      if (routed.decision.intent === "delegate_marketing") {
        try {
          const outcome = await session.port.executeAction({
            actionId: `act_cc_${shortId()}`,
            agentId: "agent_marketing_director",
            organizationId,
            toolId: "marketing.chat",
            args: {
              organizationId,
              message,
              history: session.state.conversation,
              extraContext: buildMemoryContextForChat(session),
            },
          });
          if (outcome.status === "completed") {
            const output = outcome.output as { reply?: string } | undefined;
            const marketingReply = output?.reply;
            if (marketingReply && marketingReply.trim().length > 0) {
              assistantReply = marketingReply;
              marketingTurn = {
                role: "assistant",
                content: marketingReply,
              };
            }
          }
        } catch {
          // Marketing Director failed: keep the routing reply.
        }
      }

      if (routed.decision.intent === "knowledge_query") {
        const memories = listDepartmentMemory(session, "marketing");
        if (memories.length === 0) {
          assistantReply = isEs
            ? "Todavía no tengo aprendizajes guardados de Marketing. Cuando aprendamos algo relevante, lo guardaré como conocimiento del departamento."
            : "I don't have any Marketing learnings saved yet. When we learn something relevant, I will store it as department knowledge.";
        } else {
          const lines = memories.slice(0, 5).map((m) => {
            const prefix = provenanceLabel(m.provenance, isEs);
            return `• ${m.content} (${prefix})`;
          });
          assistantReply = isEs
            ? `Esto es lo que hemos aprendido en Marketing:\n\n${lines.join("\n")}`
            : `This is what we have learned in Marketing:\n\n${lines.join("\n")}`;
        }
        marketingTurn = { role: "assistant", content: assistantReply };
      }

      if (routed.decision.intent === "remember_fact") {
        const kind = inferKindFromMessage(message);
        const title = inferTitleFromMessage(message);
        const content = message.replace(
          /^(recuerda|acuérdate|ap[úu]nta(te|me)?|guarda|anota|no olvides|remember|note this|make a note)(\s+para\s+(marketing|ventas|finanzas|operaciones))?\s*(que)?\s*/i,
          "",
        ).trim();

        rememberDepartment(session, "marketing", {
          kind,
          title: title || content.slice(0, 80),
          content,
          provenance: "ceo_statement",
          importance: 0.7,
        });

        assistantReply = isEs
          ? `Lo guardo. He apuntado esto como conocimiento del departamento de Marketing.`
          : `Saved. I have stored this as Marketing department knowledge.`;
        marketingTurn = { role: "assistant", content: assistantReply };
      }

      if (routed.decision.intent === "external_tool_query") {
        const mauticConn = session.state.connections.get("mautic");
        const mauticConnected = mauticConn?.status === "connected";

        if (!mauticConnected) {
          assistantReply = isEs
            ? "Para responderte necesito acceder a Mautic. Todavía no está conectado. Puedes conectarlo en Conexiones."
            : "To answer that I need access to Mautic. It is not connected yet. You can connect it in Connections.";
          marketingTurn = { role: "assistant", content: assistantReply };
        } else {
          const msg = message.toLowerCase();
          const isSearch =
            /\b(busca|buscar|search|find|encuentra|busco)\b/i.test(msg);
          const toolId = isSearch
            ? "mautic.contacts.search"
            : "mautic.contacts.count";

          const toolArgs = isSearch
            ? {
                query: message
                  .replace(
                    /\b(busca|buscar|search|find|encuentra|busco)\s+(en\s+mautic\s+)?(contactos?\s+)?/i,
                    "",
                  )
                  .trim(),
              }
            : {};

          try {
            const outcome = await session.port.executeAction({
              actionId: `act_mautic_${shortId()}`,
              agentId: "agent_marketing_director",
              organizationId,
              toolId,
              args: toolArgs,
            });

            if (outcome.status === "completed") {
              const output = outcome.output as { success?: boolean; count?: number; contacts?: Array<{ firstname: string; lastname: string; email: string }>; message?: string } | undefined;

              if (output?.success) {
                if (isSearch && output.contacts) {
                  const lines = output.contacts.map(
                    (c) =>
                      `• ${[c.firstname, c.lastname].filter(Boolean).join(" ")} — ${c.email}`,
                  );
                  assistantReply = isEs
                    ? `He encontrado ${output.count} contacto(s) en Mautic:\n\n${lines.join("\n")}`
                    : `I found ${output.count} contact(s) in Mautic:\n\n${lines.join("\n")}`;
                } else {
                  assistantReply = isEs
                    ? `En este momento hay ${output.count ?? 0} contactos en Mautic.`
                    : `There are currently ${output.count ?? 0} contacts in Mautic.`;
                }
              } else {
                assistantReply = isEs
                  ? `No he podido consultar Mautic: ${output?.message ?? "Error desconocido."}`
                  : `I could not query Mautic: ${output?.message ?? "Unknown error."}`;
              }
            } else {
              const reason =
                "reason" in outcome ? String(outcome.reason).slice(0, 100) : "execution failed";
              assistantReply = isEs
                ? `No he podido consultar Mautic: ${reason}`
                : `I could not query Mautic: ${reason}`;
            }
          } catch {
            assistantReply = isEs
              ? "No he podido consultar Mautic ahora mismo. Puedo seguir con el resto del trabajo."
              : "I could not query Mautic right now. I can continue with the rest of the work.";
          }
          marketingTurn = { role: "assistant", content: assistantReply };
        }
      }

      session.state.conversation = [
        ...session.state.conversation,
        { role: "user", content: message },
        marketingTurn ?? { role: "assistant", content: assistantReply },
      ];

      // Re-build proactive events so the portal can refresh cards after
      // any state change the message might have triggered.
      const events: CommandCenterEvent[] = buildProactiveOpening(session);

      return reply.code(200).send({
        organizationId,
        reply: assistantReply,
        events,
        routing: routed.decision,
        ...(routed.connectionSuggestion
          ? { connectionSuggestion: routed.connectionSuggestion }
          : { connectionSuggestion: null }),
        ...(routed.pendingToolId !== undefined
          ? { pendingToolId: routed.pendingToolId }
          : { pendingToolId: null }),
      });
    },
  );

  /** DNA suggestion approval/rejection — Sprint 60. Only explicit CEO
   *  approval invokes the canonical Company DNA mutation path. */
  server.post(
    "/api/customer-zero/:organizationId/command-center/dna-suggestion",
    {
      schema: {
        tags: ["command-center"],
        summary: "Approve or reject a DNA suggestion from a department",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["action", "suggestion"],
          properties: {
            action: { type: "string", enum: ["approve", "reject"] },
            suggestion: {
              type: "object",
              required: ["title", "content"],
              properties: {
                title: { type: "string" },
                content: { type: "string" },
                fromDepartment: { type: "string" },
                kind: { type: "string" },
                sourceMemoryIds: { type: "array" },
              },
            },
          },
          additionalProperties: false,
        },
        response: {
          200: { type: "object", additionalProperties: true },
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          500: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const { action, suggestion } = request.body as {
        action: string;
        suggestion: {
          title: string;
          content: string;
          fromDepartment?: string;
          kind?: string;
          sourceMemoryIds?: string[];
        };
      };
      const session = getCustomerZeroSession(organizationId);
      if (!session) {
        return reply.code(404).send({ error: "Session not found." });
      }
      if (action !== "approve" && action !== "reject") {
        return reply.code(400).send({ error: "Action must be 'approve' or 'reject'." });
      }

      const isEs = session.state.locale !== "en";
      if (action === "reject") {
        session.state.conversation = [
          ...session.state.conversation,
          { role: "user", content: isEs ? "No incorporar" : "Don't incorporate" },
          {
            role: "assistant",
            content: isEs
              ? "De acuerdo. No modificaré lo que sabemos de la empresa. El aprendizaje se queda como conocimiento del departamento de Marketing."
              : "Understood. I will not change what we know about the company. The learning stays as Marketing department knowledge.",
          },
        ];
        return reply.code(200).send({
          organizationId,
          action: "rejected",
          reply: isEs
            ? "La información se queda como conocimiento de Marketing. El DNA de la empresa no ha cambiado."
            : "The information stays as Marketing knowledge. Company DNA unchanged.",
        });
      }

      // APPROVE: use the canonical Company DNA write path with semantic mapping.
      const dnaKind = (suggestion.kind ?? "result") as DepartmentMemoryKind;
      let rawData: Readonly<Record<string, unknown>>;
      try {
        rawData = buildDnaRawDataFromSuggestion({
          title: suggestion.title,
          content: suggestion.content,
          fromDepartment: suggestion.fromDepartment ?? "marketing",
          kind: dnaKind,
        });
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : "Cannot promote this memory kind.";
        session.state.conversation = [
          ...session.state.conversation,
          {
            role: "user",
            content: isEs ? "Incorporar al DNA" : "Incorporate into DNA",
          },
          {
            role: "assistant",
            content: isEs
              ? `No puedo promocionar este tipo de conocimiento al DNA de la empresa. ${message}`
              : `I cannot promote this type of knowledge to Company DNA. ${message}`,
          },
        ];
        return reply.code(400).send({ error: message });
      }
      try {
        await runDiscoveryForSession(session, rawData);
      } catch (cause) {
        return reply.code(500).send({
          error: cause instanceof Error ? cause.message : "Could not update Company DNA.",
        });
      }
      const updatedDna = mostRecentReport(session)?.companyDna ?? null;

      session.state.conversation = [
        ...session.state.conversation,
        {
          role: "user",
          content: isEs ? "Incorporar al DNA" : "Incorporate into DNA",
        },
        {
          role: "assistant",
          content: isEs
            ? `Hecho. He incorporado «${suggestion.title}» al conocimiento compartido de la empresa.`
            : `Done. I have incorporated "${suggestion.title}" into the company's shared knowledge.`,
        },
      ];

      return reply.code(200).send({
        organizationId,
        action: "approved",
        reply: isEs
          ? `Conocimiento incorporado al DNA de la empresa.`
          : `Knowledge incorporated into Company DNA.`,
        dnaUpdated: Boolean(updatedDna),
      });
    },
  );
}

/** Builds Marketing-relevant department memory context for the chat tool. */
function buildMemoryContextForChat(
  session: CustomerZeroSession,
): string {
  const memories = listDepartmentMemory(session, "marketing", { limit: 5 });
  const parts: string[] = [];
  if (memories.length > 0) {
    const lines = memories.map(
      (m) => `- ${m.content} (${provenanceLabel(m.provenance, true)})`,
    );
    parts.push(`Conocimiento de Marketing:\n${lines.join("\n")}`);
  }
  // Sprint 62 — operational context is FACT. The LLM must not hallucinate a
  // missing connection for a system the capability engine says is READY, and
  // must not claim a system is available when it is not.
  const operational = buildSessionOperationalContext(session);
  parts.push(`Estado operativo de la empresa:\n${operational.promptView}`);
  return parts.join("\n\n");
}

function provenanceLabel(
  provenance: DepartmentMemoryProvenance,
  isEs: boolean,
): string {
  const labels: Record<DepartmentMemoryProvenance, string> = {
    ceo_statement: isEs ? "Dicho por ti" : "You said",
    conversation: isEs ? "Conversación" : "Conversation",
    internal_analysis: isEs ? "Aprendido de Marketing" : "Marketing insight",
    external_tool: isEs ? "Resultado externo" : "External result",
    discovery: isEs ? "Discovery inicial" : "Initial discovery",
  };
  return labels[provenance] ?? provenance;
}

function inferKindFromMessage(message: string): DepartmentMemoryKind {
  const lower = message.toLowerCase();
  if (lower.includes("público") || lower.includes("audiencia") || lower.includes("cliente ideal") || lower.includes("target") || lower.includes("icp") || lower.includes("audience")) return "audience";
  if (lower.includes("posicionam") || lower.includes("compet") || lower.includes("positioning")) return "positioning";
  if (lower.includes("mensaje") || lower.includes("tono") || lower.includes("voz") || lower.includes("messaging") || lower.includes("tone")) return "messaging";
  if (lower.includes("campaña") || lower.includes("anuncio") || lower.includes("campaign") || lower.includes("ad")) return "campaign";
  if (lower.includes("canal") || lower.includes("canales") || lower.includes("channel")) return "channel";
  if (lower.includes("decid") || lower.includes("decisi") || lower.includes("decision") || lower.includes("decidido")) return "decision";
  if (lower.includes("experiment") || lower.includes("test") || lower.includes("prueba")) return "experiment";
  if (lower.includes("resultado") || lower.includes("result") || lower.includes("convirtió") || lower.includes("conversión")) return "result";
  if (lower.includes("contenido") || lower.includes("content") || lower.includes("redacci")) return "content";
  return "note";
}

function inferTitleFromMessage(message: string): string {
  const cleaned = message
    .replace(/^(recuerda|acuérdate|ap[úu]nta(te|me)?|guarda|anota|no olvides|remember|note this|make a note)(\s+para\s+(marketing|ventas|finanzas|operaciones))?\s*(que)?\s*/i, "")
    .trim();
  return cleaned.slice(0, 80);
}

/**
 * Runs the REAL research, opening and closing each stage as the work happens.
 * No invented progress: a stage is `done` only when its work finished.
 */
async function runResearch(
  session: CustomerZeroSession,
  locale: SupportedLocale,
): Promise<void> {
  const progress = session.state.progress;
  if (!progress) return;
  const onboarding = session.state.onboarding;
  if (!onboarding) return;

  try {
    startStage(progress, "fetch");
    let interpreted: InterpretedBusiness;
    if (onboarding.hasWebsite && onboarding.url) {
      const extracted = await fetchAndExtractWebsite(onboarding.url);
      completeStage(
        progress,
        "fetch",
        extracted.title
          ? t(locale, `Hemos leído ${extracted.title}.`, `We read ${extracted.title}.`)
          : undefined,
      );
      startStage(progress, "products");
      interpreted = await interpretWebsite(extracted, session.llm.router, locale);
    } else {
      completeStage(
        progress,
        "fetch",
        t(
          locale,
          "Hemos leído lo que nos has contado.",
          "We read what you told us.",
        ),
      );
      startStage(progress, "products");
      interpreted = await interpretDescription(
        onboarding.description ?? "",
        session.llm.router,
        locale,
        onboarding.companyName,
      );
    }

    session.state.understood = { ...interpreted };
    completeStage(
      progress,
      "products",
      interpreted.products && interpreted.products.length > 0
        ? t(
            locale,
            `Hemos encontrado qué ofreces: ${interpreted.products.join(", ")}.`,
            `We found what you offer: ${interpreted.products.join(", ")}.`,
          )
        : interpreted.valueProposition
          ? t(
              locale,
              "Hemos encontrado tu propuesta principal.",
              "We found your main proposition.",
            )
          : undefined,
    );

    startStage(progress, "audience");
    const rawData = buildRawDataFromInterpretation(interpreted);
    session.state.rawData = { ...session.state.rawData, ...rawData };
    // The CEO's own company name always wins: the research may guess a name
    // from the website/description, but the explicit input is authoritative.
    session.state.companyName = onboarding.companyName;
    completeStage(
      progress,
      "audience",
      interpreted.targetAudience && interpreted.targetAudience.length > 0
        ? t(
            locale,
            `Hemos identificado a quién te diriges: ${interpreted.targetAudience.join(", ")}.`,
            `We identified who you serve: ${interpreted.targetAudience.join(", ")}.`,
          )
        : undefined,
    );

    startStage(progress, "presentation");
    completeStage(
      progress,
      "presentation",
      interpreted.tone && interpreted.tone.length > 0
        ? t(
            locale,
            `Así te presentas: ${interpreted.tone.join(", ")}.`,
            `This is how you present yourself: ${interpreted.tone.join(", ")}.`,
          )
        : undefined,
    );

    startStage(progress, "questions");
    const report = await runDiscoveryForSession(session);
    completeStage(
      progress,
      "questions",
      t(
        locale,
        "Ya sabemos qué necesitamos preguntarte.",
        "We now know what we need to ask you.",
      ),
    );
    void report;
    completeProgress(progress);
  } catch (cause) {
    failProgress(
      progress,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

function currentQuestion(
  session: CustomerZeroSession,
): ProgressiveQuestion | null {
  return selectNextQuestion(
    mostRecentReport(session),
    session.state.discovery,
    session.state.locale,
  );
}

function buildConversationPayload(session: CustomerZeroSession) {
  const report = mostRecentReport(session);
  const question = currentQuestion(session);
  return {
    organizationId: session.organizationId,
    question,
    ready: question === null || isReadyForMarketing(report, session.state.discovery),
    gapCount: report?.gaps.length ?? 0,
    connections: [...session.state.connections.values()],
    transcript: session.state.discoveryTranscript,
    intro: buildDiscoveryIntro(session),
    ...(question === null ? { handoff: buildHandoffMessage(session) } : {}),
  };
}

function buildDiscoveryIntro(session: CustomerZeroSession): string {
  const locale = session.state.locale;
  return t(
    locale,
    "Ya conozco bastante bien tu empresa. Hay algunas cosas que no puedo " +
      "saber desde fuera: te preguntaré solo lo necesario para que Marketing " +
      "pueda empezar.",
    "I already know your company quite well. There are a few things I cannot " +
      "know from the outside: I will only ask what Marketing needs to start.",
  );
}

/** Marketing's first message: Elvira diagnoses the business and explains her plan. */
function buildHandoffMessage(session: CustomerZeroSession): string {
  const locale = session.state.locale;
  const diagnosis = produceDiagnosisForSession(session);
  session.state.marketingDiagnosis = diagnosis;

  const team = produceTeamForSession(session, diagnosis);
  session.state.marketingTeam = team;

  const head = getMarketingHead();
  const parts: string[] = [
    t(
      locale,
      `Soy ${head.name}, tu Jefa de Marketing. Ya tengo una imagen bastante clara de ${diagnosis.companyName}.`,
      `I am ${head.name}, your Head of Marketing. I have a pretty clear picture of ${diagnosis.companyName}.`,
    ),
  ];

  if (diagnosis.goal) {
    parts.push(
      t(
        locale,
        `Quieres ${diagnosis.goal.toLowerCase()}.`,
        `You want to ${diagnosis.goal.toLowerCase()}.`,
      ),
    );
  }

  if (diagnosis.whereTheyAreNow) {
    parts.push(diagnosis.whereTheyAreNow);
  }

  if (diagnosis.whatToDoFirst) {
    parts.push(
      t(
        locale,
        `Por lo que he aprendido, empezaría por ${diagnosis.whatToDoFirst.toLowerCase()}.`,
        `From what I have learned, I would start with ${diagnosis.whatToDoFirst.toLowerCase()}.`,
      ),
    );
  }

  if (diagnosis.whatCanBeDoneNow.length > 1) {
    const items = diagnosis.whatCanBeDoneNow.slice(0, 3)
      .map((item, i) => `${i + 1}. ${item}`)
      .join(". ");
    parts.push(
      t(
        locale,
        `Para hacerlo bien necesito resolver: ${items}.`,
        `To do this well I need to sort out: ${items}.`,
      ),
    );
  }

  parts.push(team.message);

  parts.push(
    t(
      locale,
      "Solo te pediré ayuda cuando necesite una decisión o acceso.",
      "I will only ask for your help when I need a decision or access.",
    ),
  );

  return parts.join(" ");
}

/**
 * Capability-first: the CEO's tool answers become internal connectors and
 * connection cards. Anything Departify has no capability for is recorded
 * honestly instead of being pretended.
 */
function registerTools(
  session: CustomerZeroSession,
  values: readonly string[],
  locale: SupportedLocale,
): void {
  const other = otherOptionLabel(locale).toLowerCase();
  const noCrm = noCrmOptionLabel(locale).toLowerCase();

  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (normalized === noCrm) {
      // "No utilizo CRM" is a perfectly valid answer: accept and move on.
      continue;
    }
    if (normalized === other) {
      session.state.discovery.pendingToolDetail = true;
      continue;
    }
    const tool = resolveTool(value);
    if (!tool) {
      if (!session.state.unmappedTools.includes(value)) {
        session.state.unmappedTools.push(value);
      }
      continue;
    }
    if (!session.state.connections.has(tool.id)) {
      session.state.connections.set(
        tool.id,
        buildConnectionState(tool, locale),
      );
    }
  }
}

function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
}

function mostRecentReport(session: {
  reports: readonly CompanyDiscoveryReport[];
}): CompanyDiscoveryReport | null {
  const reports = [...session.reports].sort(
    (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime(),
  );
  return reports[0] ?? null;
}

function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export type { ConnectionState };

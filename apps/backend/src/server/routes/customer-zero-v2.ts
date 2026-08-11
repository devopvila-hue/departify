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
  getOrCreateCustomerZeroSession,
  getCustomerZeroSession,
  hydrateSessionToolState,
  persistToolState,
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
  buildConnectionStateWithLifecycle,
  completeConnection,
  domainsFor,
  hasWorkingConnector,
  resolveTool,
  startConnection,
  TOOL_CATALOG,
  type ConnectionState,
  type ToolDescriptor,
  type ToolDomain,
} from "../../customer-zero/connections.js";
import type { MarketingService } from "../../customer-zero/marketing-service.js";
import {
  isReadyForMarketing,
  isToolDiscoveryComplete,
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
  type ConnectionSuggestion,
  type RoutingDecision,
} from "../../customer-zero/command-center.js";
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle,
  type ConversationRecord,
  type ConversationMessage,
} from "../../customer-zero/conversation-store.js";
import {
  buildDnaRawDataFromSuggestion,
  listDepartmentMemory,
  rememberDepartment,
  type DepartmentMemoryKind,
  type DepartmentMemoryProvenance,
} from "../../customer-zero/department-memory.js";
import { buildSessionOperationalContext } from "../../customer-zero/operational-context.js";
import {
  enrichForChat,
  buildWorkStateEvents,
} from "../../customer-zero/chat-response-enrichment.js";
import { publicCredentialSource } from "../../customer-zero/credential-resolver.js";
import {
  hasOperationalGoogleIdentityForOrg,
} from "../../customer-zero/credential-resolver.js";
import {
  deriveGmailReadPlan as gmailDeriveReadPlan,
  renderGmailSummary,
  summarizeGmailMessage,
} from "../../customer-zero/run-gmail-presentation.js";
import {
  CONNECTION_DEFINITIONS,
  renderConnectionCard,
  listAvailableCapabilitiesForOrg,
} from "../../customer-zero/connections-domain.js";
import { isCapabilityAvailable } from "../../customer-zero/capability-registry.js";
import {
  InMemoryDepartmentWorkStore,
  checkReplyForUnsupportedPromises,
  type DepartmentWorkCapability,
  type DepartmentWorkStore,
} from "../../customer-zero/department-work.js";
import { DepartmentWorkExecutor } from "../../customer-zero/department-work-executor.js";
import type { MarketingActivityRepository } from "../../customer-zero/marketing-repositories.js";
import {
  InMemoryInboxStore,
  type InboxStore,
} from "../../customer-zero/inbox-domain.js";
import { InboxSync } from "../../customer-zero/inbox-sync.js";
import {
  startGmailOAuth,
  googleOAuthRedirectUri,
  GmailOAuthError,
} from "../../customer-zero/gmail-adapter.js";
import { getGoogleOAuthStateStore } from "../../customer-zero/oauth-state.js";
import {
  createPendingEmailWork,
  extractRecipient,
  extractObjective,
  isEmailSendRequest,
  isEmailApprovalResponse,
  isEmailCancellation,
  buildEmailDraft,
  missingFieldsCopy,
  type PendingEmailWork,
} from "../../customer-zero/pending-email.js";
import {
  isEmailCapabilityOperational,
  sendEmail,
  resolveOperationalEmailProvider,
} from "../../customer-zero/email-capability.js";
import { getCorporateEmailStore } from "../../customer-zero/corporate-email-store.js";
import {
  completeGoogleOAuthCallback,
  getGoogleTokenStore,
  type GoogleTokenProvider,
} from "../../customer-zero/google-tokens.js";
import type { CompanyDiscoveryReport } from "@departify/business-discovery";
import type { ServerDeps } from "../deps.js";
import {
  evaluateDnaCompleteness,
  type CompanyDnaStore,
} from "../../customer-zero/company-dna.js";
import {
  projectIntakeToDna,
  projectResearchToDna,
  markMilestone,
  applyCeoConfirmation,
  readinessFactsFromRecord,
  resolveCompanyDnaStore,
  hydrateSessionFromCompanyDna,
  type CeoCorrections,
} from "../../customer-zero/company-readiness.js";
import { evaluateReadiness as evaluateReadinessReport } from "../../customer-zero/context-readiness.js";
import { checkpoint } from "../../customer-zero/onboarding-checkpoints.js";
import {
  buildDeclaredToolState,
  humanLifecycleLabel,
  type OrganizationToolState,
  type ToolLifecycleStatus,
} from "../../customer-zero/tool-state.js";

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
        // Customer Zero P0 — CONTINUITY FOR EXISTING ORGANIZATIONS.
        //
        // Company DNA is new, so organizations that onboarded before it
        // existed have no durable record. Those CEOs must complete the
        // (now real) understanding + confirmation step — but they must
        // NOT be given a brand-new organization to do it in. Their Gmail
        // tokens, conversations, connections, inbox and Marketing state
        // are all keyed by organization id; creating a second tenant
        // would silently orphan every one of them.
        //
        // So: if the CEO already owns an organization that has no
        // Company DNA yet, we ADOPT it and write the DNA there.
        // A CEO who genuinely already has a ready company is not sent
        // through /start by the portal at all.
        const existing = await deps.organizations.listForUser(ownerId);
        const dnaStoreForAdoption = resolveCompanyDnaStore(deps);
        let adopted: string | null = null;
        for (const organization of existing) {
          const record = await dnaStoreForAdoption.get(
            organization.organizationId,
          );
          if (!record) {
            adopted = organization.organizationId;
            break;
          }
        }
        if (adopted) {
          organizationId = adopted;
        } else {
          const organization = await deps.organizations.createOrganization(
            body.companyName.trim(),
            ownerId,
          );
          organizationId = organization.organizationId;
        }
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
      const session = getOrCreateCustomerZeroSession(organizationId, {
        locale,
        ...(deps.toolState ? { toolState: deps.toolState } : {}),
        ...(deps.conversations ? { conversations: deps.conversations } : {}),
      });
      await hydrateSessionToolState(session);
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

      // Customer Zero P0 — the company becomes DURABLE at the very first
      // step. From here on a reload or a backend restart can reconstruct
      // who this company is without asking the CEO to start over.
      const dnaStore = resolveCompanyDnaStore(deps);
      const now = new Date().toISOString();
      await dnaStore.upsert(
        projectIntakeToDna(
          organizationId,
          session.state.onboarding,
          now,
          await dnaStore.get(organizationId),
        ),
      );
      checkpoint("customer_zero_started", organizationId);

      // The research runs in the background: the UI follows the REAL stages.
      void runResearch(session, locale, dnaStore).catch(() => {
        /* progress already carries the failure */
      });

      return reply.code(200).send({
        organizationId,
        ...(normalizedUrl ? { url: normalizedUrl } : {}),
        estimatedMs: estimatedTotalMs(),
      });
    },
  );

  // Customer Zero P0 — resume/retry the REAL research for an EXISTING
  // organization. A research failure or a backend restart must never
  // strand the company: this endpoint restarts research on the SAME
  // organization (never a replacement org) and is idempotent while a
  // run is already in flight.
  server.post(
    "/api/customer-zero/:organizationId/research",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Resume/retry company research for an existing organization",
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
      const session = await requireSession(organizationId, deps);
      const progress = session.state.progress;
      if (progress && progress.status === "running") {
        return reply.code(200).send({ organizationId, status: "running" });
      }
      if (!session.state.onboarding) {
        return reply.code(404).send({ error: "No hay empresa que investigar." });
      }
      const dnaStore = resolveCompanyDnaStore(deps);
      const locale = session.state.locale;
      checkpoint("research_started", organizationId);
      void runResearch(session, locale, dnaStore).catch(() => {
        /* runResearch records the failure on progress itself */
      });
      return reply.code(200).send({ organizationId, status: "running" });
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
      const session = await requireSession(organizationId, deps);
      if (!session.state.progress) {
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
      const session = await requireSession(organizationId, deps);
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
      const session = await requireSession(organizationId, deps);

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
        body.questionId.startsWith("tools:") ||
        body.questionId === "ops:crm" ||
        body.questionId === "ops:tool_other"
      ) {
        await registerTools(session, values, locale);
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

      // Customer Zero P0 — the CEO's answers are durable business facts,
      // and completing the BLOCKING questions is a durable milestone.
      // Only blocking facts can gate readiness; useful/optional answers
      // enrich the record without ever holding the CEO at the door.
      const dnaStore = resolveCompanyDnaStore(deps);
      const record = await dnaStore.get(organizationId);
      if (record) {
        const declaredTools = [...session.state.connections.keys()];
        const enriched = {
          ...record,
          // Tools the CEO DECLARED. This is a business fact and never a
          // claim that the tool is connected — real connection health
          // lives in the tool state store.
          ...(declaredTools.length > 0 ? { declaredTools } : {}),
        };
        await dnaStore.upsert(enriched);
        if (isToolDiscoveryComplete(session.state.discovery)) {
          await markMilestone(
            organizationId,
            dnaStore,
            "blockingDiscoveryCompletedAt",
            new Date().toISOString(),
          );
          checkpoint("blocking_discovery_completed", organizationId);
        }
      }

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
      const session = await requireSession(organizationId, deps);
      // Customer Zero 01 — render the canonical 5-state card view for
      // every supported connection, including those not yet declared.
      const toolStates = await listToolStatesForSession(session);
      const cards = CONNECTION_DEFINITIONS.map((def) => {
        const orgState = toolStates.find((s) => s.toolId === def.id) ?? null;
        return renderConnectionCard(orgState, session.state.locale);
      });
      return reply.code(200).send({
        organizationId,
        connections: await buildCatalogConnectionViews(session, session.state.locale),
        cards,
        unmappedTools: session.state.unmappedTools,
      });
    },
  );

  // Customer Zero 01 — single connection detail.
  server.get<{
    Params: { organizationId: string; provider: string };
  }>(
    "/api/customer-zero/:organizationId/connections/:provider",
    async (request, reply) => {
      const { organizationId, provider } = request.params;
      const session = await requireSession(organizationId, deps);
      const toolStates = await listToolStatesForSession(session);
      const orgState = toolStates.find((s) => s.toolId === provider) ?? null;
      const card = renderConnectionCard(orgState, session.state.locale);
      if (card.id === "unknown") {
        return reply.code(404).send({ error: "unknown_provider" });
      }
      return {
        organizationId,
        provider: card.id,
        name: card.name,
        state: card.state,
        stateLabel: card.stateLabel,
        capabilities: card.capabilities,
        configSource: card.configSource,
        verifiedAt: card.verifiedAt,
      };
    },
  );

  // Customer Zero 01 — live test of a connection.
  server.post<{
    Params: { organizationId: string; provider: string };
  }>(
    "/api/customer-zero/:organizationId/connections/:provider/test",
    async (request, reply) => {
      const { organizationId, provider } = request.params;
      if (provider !== "mautic") {
        return reply.code(404).send({ error: "unsupported_provider" });
      }
      const session = await requireSession(organizationId, deps);
      const resolution = await testMauticForOrg(session);
      // Update the tool state based on the test result.
      const toolStateStore = session.toolState;
      const now = new Date().toISOString();
      const current = (await toolStateStore.get(organizationId, "mautic")) ?? null;
      await toolStateStore.upsert({
        organizationId,
        toolId: "mautic",
        label: "Mautic",
        capability: "crm.contacts.read",
        declared: true,
        status: resolution.success ? "connected" : resolution.code === "auth" ? "degraded" : "needs_connection",
        ...(resolution.available ? { configSource: "env:mautic" as const } : {}),
        ...(resolution.success ? { verifiedAt: now } : current?.verifiedAt ? { verifiedAt: current.verifiedAt } : {}),
        health: resolution.success ? "operational" : "down",
        updatedAt: now,
      });
      return {
        provider,
        state: resolution.success ? "connected" : "needs_attention",
        message: resolution.message,
        available: resolution.available,
      };
    },
  );

  // Customer Zero 01 — capabilities available to this organization.
  server.get<{
    Params: { organizationId: string };
  }>(
    "/api/customer-zero/:organizationId/capabilities",
    async (request) => {
      const { organizationId } = request.params;
      const session = await requireSession(organizationId, deps);
      const toolStates = await listToolStatesForSession(session);
      const caps = listAvailableCapabilitiesForOrg(toolStates);
      return {
        organizationId,
        capabilities: caps,
      };
    },
  );

  // Customer Zero 01 P0 — durable work feed.
  server.get<{
    Params: { organizationId: string };
    Querystring: { since?: string; limit?: string };
  }>(
    "/api/customer-zero/:organizationId/work-feed",
    async (request) => {
      const { organizationId } = request.params;
      const since = request.query?.since ?? "1970-01-01T00:00:00.000Z";
      const limit = Number(request.query?.limit ?? 50);
      await requireSession(organizationId, deps);
      const workStore = getWorkStore();
      const tasks = await workStore.listTasksForOrg(organizationId, limit);
      const results = await workStore.listResultsForOrg(organizationId, limit);
      const fresh = await workStore.feedSince(organizationId, since);
      return {
        organizationId,
        tasks,
        results,
        newTasks: fresh.tasks,
        newResults: fresh.results,
        serverTime: fresh.serverTime,
      };
    },
  );

  // Customer Zero 01 P0 — list results.
  server.get<{
    Params: { organizationId: string };
    Querystring: { limit?: string };
  }>(
    "/api/customer-zero/:organizationId/results",
    async (request) => {
      const { organizationId } = request.params;
      const limit = Number(request.query?.limit ?? 50);
      await requireSession(organizationId, deps);
      const workStore = getWorkStore();
      const results = await workStore.listResultsForOrg(organizationId, limit);
      return { organizationId, results };
    },
  );

  // Customer Zero 01 P0 — single result detail.
  server.get<{
    Params: { organizationId: string; resultId: string };
  }>(
    "/api/customer-zero/:organizationId/results/:resultId",
    async (request, reply) => {
      const { organizationId, resultId } = request.params;
      await requireSession(organizationId, deps);
      const workStore = getWorkStore();
      const result = await workStore.getResult(resultId);
      if (!result || result.organizationId !== organizationId) {
        return reply.code(404).send({ error: "result_not_found" });
      }
      return { organizationId, result };
    },
  );

  // Customer Zero 03 — unified inbox endpoints.
  // Durable via `deps.inbox` (Supabase) when wired in production; otherwise
  // the in-memory store keeps tests deterministic.
  const inboxStore: InboxStore = deps.inbox ?? new InMemoryInboxStore();
  const inboxSync = new InboxSync(inboxStore);

  server.get<{
    Params: { organizationId: string };
    Querystring: { category?: string; state?: string; limit?: string };
  }>(
    "/api/customer-zero/:organizationId/inbox",
    async (request) => {
      const { organizationId } = request.params;
      await requireSession(organizationId, deps);
      const items = await inboxStore.list({
        organizationId,
        ...(request.query?.category
          ? { category: request.query.category as Parameters<typeof inboxStore.list>[0]["category"] }
          : {}),
        ...(request.query?.state
          ? { state: request.query.state as Parameters<typeof inboxStore.list>[0]["state"] }
          : {}),
        limit: Number(request.query?.limit ?? 50),
      } as Parameters<typeof inboxStore.list>[0]);
      return { organizationId, items };
    },
  );

  server.post<{
    Params: { organizationId: string };
    Body: { maxResults?: number };
  }>(
    "/api/customer-zero/:organizationId/inbox/sync",
    async (request) => {
      const { organizationId } = request.params;
      await requireSession(organizationId, deps);
      // V1 sync uses the organizationId as the user key. Production
      // should resolve the CEO's user id from the authenticated
      // session.
      const result = await inboxSync.run({
        organizationId,
        userId: organizationId,
        ...(request.body?.maxResults ? { maxResults: request.body.maxResults } : {}),
      });
      return { organizationId, ...result };
    },
  );

  server.get<{
    Params: { organizationId: string; itemId: string };
  }>(
    "/api/customer-zero/:organizationId/inbox/:itemId",
    async (request, reply) => {
      const { organizationId, itemId } = request.params;
      await requireSession(organizationId, deps);
      const item = await inboxStore.get(itemId);
      if (!item || item.organizationId !== organizationId) {
        return reply.code(404).send({ error: "inbox_item_not_found" });
      }
      return { organizationId, item };
    },
  );

  // CZ03 — Inbox → work bridge. Converts a classified InboxItem into a durable
  // DepartmentTask (reusing the existing work store + status lifecycle). The
  // item records `relatedWorkItemId` + state `in_work` so the CEO can follow
  // the work from /tareas and the approval flow continues unchanged. No new
  // inbox runtime — the existing task/approval/result infrastructure owns the
  // work once created.
  server.post<{
    Params: { organizationId: string; itemId: string };
    Body: { capability?: string; note?: string };
  }>(
    "/api/customer-zero/:organizationId/inbox/:itemId/work",
    async (request, reply) => {
      const { organizationId, itemId } = request.params;
      await requireSession(organizationId, deps);
      const item = await inboxStore.get(itemId);
      if (!item || item.organizationId !== organizationId) {
        return reply.code(404).send({ error: "inbox_item_not_found" });
      }
      const categoryLabel: Record<string, string> = {
        lead: "Oportunidad de cliente",
        customer_question: "Consulta de cliente",
        campaign_response: "Respuesta de campaña",
        support: "Solicitud de soporte",
        administrative: "Asunto administrativo",
        unknown: "Mensaje",
      };
      const title = `${categoryLabel[item.category] ?? "Mensaje"}: ${item.subject || "(sin asunto)"}`;
      const summary = `De ${item.sender.email} — ${item.preview || item.subject || "mensaje del inbox unificado"}`;
      const workStore = getWorkStore();
      const requestedCapability = request.body?.capability;
      const capability: DepartmentWorkCapability =
        requestedCapability &&
        ["crm.contacts.list", "crm.contacts.summary", "crm.segments.list", "crm.campaigns.list", "results.publish", "memory.remember"].includes(requestedCapability)
          ? (requestedCapability as DepartmentWorkCapability)
          : "results.publish";
      const task = await workStore.createTask({
        organizationId,
        departmentId: item.departmentId ?? "marketing",
        objectiveId: null,
        requestedBy: "ceo",
        title,
        summary,
        capability,
        toolId: "inbox_work",
        status: "queued",
        statusMessage: "Trabajo creado desde el inbox unificado.",
        progress: 0,
        requiredCapabilities: [],
        startedAt: null,
        completedAt: null,
        resultId: null,
        errorCode: null,
        errorMessage: null,
        timeoutMs: 60_000,
      });
      await inboxStore.setRelatedWorkItem(item.id, task.id);
      const updated = await inboxStore.get(item.id);
      return {
        organizationId,
        task,
        item: updated,
      };
    },
  );

  // Customer Zero 01 P0 — trigger a long-running work item.
  server.post<{
    Params: { organizationId: string };
    Body: {
      capability: string;
      title: string;
      summary: string;
      conversationId: string;
      objectiveId?: string;
    };
  }>(
    "/api/customer-zero/:organizationId/work-items",
    async (request, reply) => {
      const { organizationId } = request.params;
      const body = request.body;
      const session = await requireSession(organizationId, deps);
      const locale = resolveLocale(session.state.locale);
      const executor = createWorkExecutor(organizationId);
      try {
        const outcome = await executor.run({
          organizationId,
          conversationId: body.conversationId,
          departmentId: "marketing",
          objectiveId: body.objectiveId ?? null,
          requestedBy: "ceo",
          title: body.title,
          summary: body.summary,
          capability: body.capability as Parameters<typeof isCapabilityAvailable>[1],
          locale,
        });
        // Auto-inject the final message into the conversation.
        await session.conversations.addMessage(
          body.conversationId,
          "assistant",
          outcome.finalMessage,
        );
        return {
          organizationId,
          task: outcome.task,
          result: outcome.result,
          activity: outcome.activity,
        };
      } catch (error) {
        return reply.code(500).send({
          error: "work_failed",
          message: error instanceof Error ? error.message : "Unknown failure",
        });
      }
    },
  );

  // Customer Zero 01 P0 — promise guard. The frontend can call this
  // before trusting an engine reply that includes "te aviso" /
  // "lo dejo en Resultados" phrases.
  server.post<{
    Body: { reply: string };
  }>(
    "/api/customer-zero/promise-guard",
    async (request) => {
      const { reply } = request.body;
      const guard = checkReplyForUnsupportedPromises(reply);
      return guard;
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
      const session = await requireSession(organizationId, deps);
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
          connection.lifecycle = "needs_connection";
          connection.blockedReason = connIsEs
            ? `Faltan las credenciales para conectar Mautic: MAUTIC_BASE_URL, MAUTIC_CLIENT_ID o MAUTIC_CLIENT_SECRET.`
            : `Missing credentials to connect Mautic: MAUTIC_BASE_URL, MAUTIC_CLIENT_ID, or MAUTIC_CLIENT_SECRET.`;
          connection.missingCredentials = ["MAUTIC_BASE_URL", "MAUTIC_CLIENT_ID", "MAUTIC_CLIENT_SECRET"].filter(
            (key) => !env[key]?.trim(),
          );
          await persistToolState(session, toolStateFromConnection(session, connection));
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
            connection.lifecycle = "connected";
            connection.verifiedAt = new Date().toISOString();
            await persistToolState(session, toolStateFromConnection(session, connection));
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
            connection.lifecycle =
              connection.lifecycle === "connected" ? "degraded" : "unavailable";
            connection.blockedReason = connIsEs
              ? `No se pudo validar la conexión con Mautic: ${msg}`
              : `Could not validate Mautic connection: ${msg}`;
            await persistToolState(session, toolStateFromConnection(session, connection));
          }
        } catch (cause) {
          connection.status = "blocked";
          connection.lifecycle =
            connection.lifecycle === "connected" ? "degraded" : "unavailable";
          connection.blockedReason = connIsEs
            ? `Error al conectar con Mautic: ${cause instanceof Error ? cause.message : "Error desconocido"}`
            : `Error connecting to Mautic: ${cause instanceof Error ? cause.message : "Unknown error"}`;
          await persistToolState(session, toolStateFromConnection(session, connection));
        }
        return reply.code(200).send({ organizationId, connection });
      }

      const googleTools = new Set([
        "gmail",
        "google_workspace",
        "google_calendar",
        "google_drive",
      ]);
      const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]?.trim();
      const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]?.trim();

      if (googleTools.has(tool.id)) {
        // CZ03 — unified Google handshake. One authorization URL grants the
        // Google capabilities. The `state` nonce is bound to
        // (organizationId, userId, intent, returnPath) in the OAuth state
        // store for CSRF / replay / org+user mismatch protection.
        const missing = [];
        if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
        if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
        if (missing.length > 0) {
          connection.status = "blocked";
          connection.blockedReason = t(
            session.state.locale,
            `Faltan las credenciales de Google para conectar ${tool.label}.`,
            `Missing Google credentials to connect ${tool.label}.`,
          );
          connection.missingCredentials = missing;
          await persistToolState(session, toolStateFromConnection(session, connection));
          return reply.code(200).send({ organizationId, connection });
        }
        const oauthUserId = request.authUser?.id ?? organizationId;
        // P0 — Use the canonical Google OAuth redirect URI helper.
        // organizationId/userId/toolId travel through the state nonce,
        // NOT through the URL. This URL is identical to the one the
        // browser reaches after consent AND the one we send to
        // oauth2.googleapis.com/token.
        const out = await startGmailOAuth({
          organizationId,
          userId: oauthUserId,
          returnPath: "/connections/google/callback",
          locale: session.state.locale,
          redirectUri: googleOAuthRedirectUri(deps.publicBaseUrl),
          clientId: clientId as string,
        });
        connection.status = "connecting";
        connection.authorizationUrl = out.authorizationUrl;
        connection.oauthState = out.state;
        await persistToolState(session, toolStateFromConnection(session, connection));
        return reply.code(200).send({ organizationId, connection });
      }

      // Non-Google tools (Outlook / Microsoft 365). Each provider has
      // its own OAuth Web Client registered against a stable portal
      // path. Per-organization URLs are NEVER used; organization
      // identity travels through the OAuth state.
      const fallbackRedirectUri = `${(deps.publicBaseUrl ?? publicBaseUrl()).replace(/\/+$/, "")}/connections/${tool.id}/callback`;
      startConnection(
        connection,
        tool,
        {
          env: process.env,
          redirectUri: fallbackRedirectUri,
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
          properties: {
            code: { type: "string", minLength: 1 },
            state: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          200: { type: "object", additionalProperties: true },
          400: { type: "object", additionalProperties: true },
          401: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", additionalProperties: true },
          500: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, toolId } = request.params as {
        organizationId: string;
        toolId: string;
      };
      const session = await requireSession(organizationId, deps);
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

      const googleTools = new Set([
        "gmail",
        "google_workspace",
        "google_calendar",
        "google_drive",
      ]);
      if (googleTools.has(toolId)) {
        const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]?.trim();
        const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]?.trim();
        if (!clientId || !clientSecret) {
          return reply.code(409).send({
            organizationId,
            connection,
            error: {
              code: "GOOGLE_OAUTH_NOT_CONFIGURED",
              message: "Google OAuth client credentials are not configured.",
            },
          });
        }
        const { code, state } = (request.body ?? {}) as {
          code?: string;
          state?: string;
        };
        if (!code || !state) {
          return reply.code(400).send({
            organizationId,
            error: { code: "MISSING_CODE_OR_STATE", message: "code and state are required." },
          });
        }
        const oauthUserId = request.authUser?.id ?? organizationId;
        // P0 — The redirect_uri exchanged at the Google token endpoint
        // MUST be byte-identical to the one used when the user was sent
        // to `accounts.google.com/.../auth`. Both come from
        // `googleOAuthRedirectUri(deps.publicBaseUrl)` so they CANNOT
        // drift apart. The portal route `/connections/google/callback`
        // is the single authorized redirect URI configured on the
        // OAuth Web Client.
        //
        // The actual handshake pipeline is `completeGoogleOAuthCallback`,
        // which:
        //   1. Validates the OAuth state nonce.
        //   2. Exchanges the code with the byte-exact redirect_uri.
        //   3. Parses the GRANTED scopes (replacing any prior set).
        //   4. PRESERVES the existing refresh_token when Google omits
        //      a new one on a reconnect.
        //   5. Persists to the durable Supabase-backed store (or in
        //      memory when Supabase is not wired).
        //   6. Runs the Gmail operational probe (gmail.users.getProfile).
        //   7. Marks the connection operational ONLY when the probe
        //      succeeded AND a refresh token is persisted.
        const provider: GoogleTokenProvider =
          toolId === "gmail"
            ? "gmail"
            : toolId === "google_workspace"
              ? "google_workspace"
              : toolId === "google_calendar"
                ? "google_calendar"
                : "google_drive";
        try {
          const tokenResult = await completeGoogleOAuthCallback({
            code,
            state,
            organizationId,
            userId: oauthUserId,
            clientId,
            clientSecret,
            redirectUri: googleOAuthRedirectUri(deps.publicBaseUrl),
            provider,
            identityProvider: "gmail",
            stateNonceLookup: async (nonce) => {
              const s = await getGoogleOAuthStateStore().get(nonce);
              return s
                ? { organizationId: s.organizationId, userId: s.userId }
                : null;
            },
            stateNonceConsume: async (nonce) => {
              await getGoogleOAuthStateStore().consume(nonce);
            },
            // SAFE diagnostics: checkpoint names + safe fields only.
            // Never codes, tokens, secrets, headers or payloads.
            onCheckpoint: (checkpoint, data) => {
              request.log.info({
                event: checkpoint,
                organizationId,
                ...data,
              });
            },
          });
          // Safe log: no tokens, no client secret. Used for the
          // production diagnostic trace (see PHASE 1 of the brief).
          request.log.info({
            event: "google_oauth_callback_complete",
            organizationId,
            provider,
            grantedScopes: tokenResult.grantedScopes,
            hasRefreshToken: tokenResult.hasRefreshToken,
            operational: tokenResult.operational,
            probeError: tokenResult.probe.error,
          });

          // Persist the operational record on the durable tool-state so
          // /conexiones, the chat pipeline, and the connection card
          // all read the same source of truth.
          if (tokenResult.operational) {
            completeConnection(connection);
            connection.configSource = "oauth:google";
            connection.verifiedAt = new Date().toISOString();
            connection.connectedAt = new Date().toISOString();
          } else {
            // Honest recovery state — the OAuth handshake completed
            // but we never reached "operational". The connection card
            // surfaces a real next step (reauthorize) instead of a
            // generic "preparando".
            connection.lifecycle = "needs_connection";
            connection.status = "blocked";
            const why = tokenResult.hasRefreshToken
              ? `Google no respondió a la verificación operativa (${tokenResult.probe.error ?? "unknown"}).`
              : "Google no devolvió un refresh_token. Vuelve a autorizar la conexión.";
            connection.blockedReason = why;
            connection.missingCredentials = tokenResult.hasRefreshToken
              ? []
              : ["GOOGLE_OAUTH_REFRESH_TOKEN"];
          }
          await persistToolState(session, toolStateFromConnection(session, connection));

          return reply.code(200).send({
            organizationId,
            connection,
            identity: tokenResult.identity,
            grantedScopes: tokenResult.grantedScopes,
            operational: tokenResult.operational,
            probe: tokenResult.probe,
            email: tokenResult.identity.email,
          });
        } catch (cause) {
          // STATE-MACHINE INVARIANT: every callback outcome must leave
          // "connecting". On ANY failure we transition the connection to
          // a terminal state with an actionable reason BEFORE returning
          // the error — otherwise the card would stay "Conectando…"
          // forever after a failed/never-arriving handshake.
          const safeReason =
            cause instanceof Error ? cause.message : String(cause);
          transitionGoogleConnectionToTerminal(connection, safeReason);
          await persistToolState(
            session,
            toolStateFromConnection(session, connection),
          );
          if (cause instanceof GmailOAuthError) {
            return reply.code(401).send({
              organizationId,
              connection,
              error: {
                code: cause.code,
                message: cause.message,
                requestId: request.id,
                statusCode: 401,
              },
            });
          }
          const err = cause as Error & { code?: string };
          // OAuth state validation failures (CSRF / replay /
          // org mismatch / user mismatch) emit an Error with a
          // string `code`. Surface them as 401 — they are routine
          // client errors, never infrastructure faults. Other coded
          // errors (e.g. credential_persisted_but_not_readable) are
          // server-side and stay 500.
          const oauthClientCodes = new Set([
            "invalid_state",
            "org_mismatch",
            "user_mismatch",
            "replay",
          ]);
          if (typeof err.code === "string" && oauthClientCodes.has(err.code)) {
            return reply.code(401).send({
              organizationId,
              connection,
              error: {
                code: err.code,
                message: err.message,
                requestId: request.id,
                statusCode: 401,
              },
            });
          }
          const code = err.code ?? "GOOGLE_OAUTH_FAILED";
          request.log.error({
            event: "google_oauth_callback_failed",
            organizationId,
            provider,
            code,
            message: err.message,
          });
          return reply.code(500).send({
            organizationId,
            connection,
            error: {
              code,
              message: "Google OAuth callback failed.",
              requestId: request.id,
              statusCode: 500,
            },
          });
        }
      }

      completeConnection(connection);
      return reply.code(200).send({ organizationId, connection });
    },
  );

  // Customer Zero Email P0 — "Otro correo de empresa" (IMAP + SMTP).
  // Configure + bounded probe. The password NEVER leaves the request
  // boundary and is NEVER returned in the response.
  server.post(
    "/api/customer-zero/:organizationId/connections/corporate-email/configure",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Configure a corporate email account (IMAP + SMTP) with a bounded probe",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["email", "username", "password", "imapHost", "smtpHost"],
          properties: {
            email: { type: "string" },
            username: { type: "string" },
            password: { type: "string", minLength: 1 },
            imapHost: { type: "string" },
            imapPort: { type: "number", default: 993 },
            imapSecure: { type: "boolean", default: true },
            smtpHost: { type: "string" },
            smtpPort: { type: "number", default: 587 },
            smtpSecure: { type: "boolean", default: true },
            displayName: { type: "string" },
          },
          additionalProperties: false,
        },
        response: {
          200: { type: "object", additionalProperties: true },
          400: { type: "object", properties: { error: { type: "object" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      await requireSession(organizationId, deps);
      const body = request.body as {
        email: string;
        username: string;
        password: string;
        imapHost: string;
        imapPort?: number;
        imapSecure?: boolean;
        smtpHost: string;
        smtpPort?: number;
        smtpSecure?: boolean;
        displayName?: string;
      };
      const email = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return reply.code(400).send({
          error: { code: "INVALID_EMAIL", message: "Dirección de correo inválida." },
        });
      }
      const userId = request.authUser?.id ?? organizationId;
      const account = {
        organizationId,
        userId,
        provider: "imap_smtp" as const,
        email,
        username: body.username.trim(),
        password: body.password,
        imapHost: body.imapHost.trim(),
        imapPort: body.imapPort ?? 993,
        imapSecure: body.imapSecure ?? true,
        smtpHost: body.smtpHost.trim(),
        smtpPort: body.smtpPort ?? 587,
        smtpSecure: body.smtpSecure ?? true,
        displayName: body.displayName?.trim() || null,
        operationalVerifiedAt: null,
        operationalProbeError: null,
      };
      // Bounded real probe (IMAP connect+INBOX, SMTP session). Never
      // sends mail. Only mark operational when BOTH succeed.
      const { probeCorporateEmail } = await import(
        "../../customer-zero/corporate-email-adapter.js"
      );
      const probe = await probeCorporateEmail(account);
      const stored = {
        ...account,
        operationalVerifiedAt: probe.operational
          ? new Date().toISOString()
          : null,
        operationalProbeError: probe.operational ? null : probe.error,
      };
      const { getCorporateEmailStore } = await import(
        "../../customer-zero/corporate-email-store.js"
      );
      await getCorporateEmailStore().put(stored);
      // Safe log: never the password, never the username internals.
      request.log.info({
        event: "corporate_email_configured",
        organizationId,
        email,
        operational: probe.operational,
        probeError: probe.error,
      });
      return reply.code(200).send({
        organizationId,
        email,
        operational: probe.operational,
        probe: {
          imapOk: probe.imapOk,
          smtpOk: probe.smtpOk,
          error: probe.error,
        },
      });
    },
  );

  // Re-probe the stored corporate account (no password resubmission).
  server.post(
    "/api/customer-zero/:organizationId/connections/corporate-email/verify",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "Re-probe the stored corporate email account",
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
      await requireSession(organizationId, deps);
      const userId = request.authUser?.id ?? organizationId;
      const { getCorporateEmailStore } = await import(
        "../../customer-zero/corporate-email-store.js"
      );
      const store = getCorporateEmailStore();
      const account = await store.get(organizationId, userId);
      if (!account) {
        return reply.code(404).send({ error: "No hay cuenta de correo configurada." });
      }
      const { probeCorporateEmail } = await import(
        "../../customer-zero/corporate-email-adapter.js"
      );
      const probe = await probeCorporateEmail(account);
      await store.put({
        ...account,
        operationalVerifiedAt: probe.operational
          ? new Date().toISOString()
          : null,
        operationalProbeError: probe.operational ? null : probe.error,
      });
      request.log.info({
        event: "corporate_email_verified",
        organizationId,
        email: account.email,
        operational: probe.operational,
        probeError: probe.error,
      });
      return reply.code(200).send({
        organizationId,
        email: account.email,
        operational: probe.operational,
        probe: {
          imapOk: probe.imapOk,
          smtpOk: probe.smtpOk,
          error: probe.error,
        },
      });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/connections/:toolId/declare",
    {
      schema: {
        tags: ["customer-zero"],
        summary:
          "Declare a catalog tool for the organization (durable, never connected)",
        params: {
          type: "object",
          required: ["organizationId", "toolId"],
          properties: {
            organizationId: { type: "string" },
            toolId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "connection"],
            properties: {
              organizationId: { type: "string" },
              connection: { type: "object", additionalProperties: true },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, toolId } = request.params as {
        organizationId: string;
        toolId: string;
      };
      const session = await requireSession(organizationId, deps);
      const tool = TOOL_CATALOG.find((entry) => entry.id === toolId);
      if (!tool) {
        return reply.code(404).send({ error: "Tool not found in catalog." });
      }
      await declareCatalogTool(session, tool);
      const view = (await buildCatalogConnectionViews(session, session.state.locale)).find(
        (entry) => entry.toolId === toolId,
      );
      return reply.code(200).send({ organizationId, connection: view });
    },
  );

  // ------------------------------------------------------------------
  // CEO CONFIRMATION — Customer Zero P0.
  //
  // The step that did not exist. Before this, `ceoConfirmed` was read
  // from a research stage id ("confirmation") that no code ever set and
  // that was not even a member of `ResearchStageId` — so the readiness
  // gate could never pass for ANY company, while the portal walked the
  // CEO into the operational chat regardless.
  //
  // These two endpoints make the confirmation real and durable:
  //   GET  .../understanding — what we understood, in business language
  //   POST .../confirm       — the CEO corrects and confirms it
  // ------------------------------------------------------------------
  server.get(
    "/api/customer-zero/:organizationId/understanding",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "What Departify understood about the company, for CEO review",
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
      const store = resolveCompanyDnaStore(deps);
      const record = await store.get(organizationId);
      if (!record) {
        return reply.code(404).send({ error: "Company not found." });
      }
      const readiness = readinessFactsFromRecord(record);
      const completeness = evaluateDnaCompleteness(record);
      // Business language only. No JSON schemas, no DNA internals, no
      // "context compiler" — the CEO sees understanding, not plumbing.
      return reply.code(200).send({
        organizationId,
        companyName: record.companyName,
        ...(record.description ? { description: record.description } : {}),
        ...(record.objective ? { objective: record.objective } : {}),
        ...(record.geography
          ? { geography: record.geography }
          : record.country
            ? { geography: record.country }
            : {}),
        products: record.products,
        customers: record.customers,
        ...(record.positioning ? { positioning: record.positioning } : {}),
        ...(record.businessModel ? { businessModel: record.businessModel } : {}),
        declaredTools: record.declaredTools,
        uncertainties: record.uncertainties,
        provenance: record.provenance,
        confirmed: readiness.ceoConfirmed,
        missing: completeness.missing,
      });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/confirm",
    {
      schema: {
        tags: ["customer-zero"],
        summary: "The CEO corrects and confirms the company understanding",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            companyName: { type: "string" },
            description: { type: "string" },
            objective: { type: "string" },
            geography: { type: "string" },
            products: { type: "array", items: { type: "string" } },
            customers: { type: "array", items: { type: "string" } },
            declaredTools: { type: "array", items: { type: "string" } },
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
      const corrections = (request.body ?? {}) as CeoCorrections;
      const store = resolveCompanyDnaStore(deps);
      const record = await store.get(organizationId);
      if (!record) {
        return reply.code(404).send({ error: "Company not found." });
      }
      // Corrections are merged FIRST, then the confirmation is stamped —
      // so the confirmation always refers to the facts we actually
      // stored, never to a version the CEO never saw.
      const confirmed = applyCeoConfirmation(
        record,
        corrections,
        new Date().toISOString(),
      );
      await store.upsert(confirmed);
      checkpoint("ceo_confirmation_completed", organizationId);
      checkpoint("company_dna_persisted", organizationId);

      const facts = readinessFactsFromRecord(confirmed);
      const readiness = evaluateReadinessReport(facts);
      return reply.code(200).send({
        organizationId,
        confirmed: true,
        contextReady: readiness.ready,
        contextMissing: readiness.missing,
      });
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
      const session = await requireSession(organizationId, deps);
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
      const session = await requireSession(organizationId, deps);
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
      const session = await requireSession(organizationId, deps);
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
            conversationId: { type: "string" },
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
              conversationId: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: {
            type: "object",
            required: ["error"],
            properties: {
              error: {
                type: "object",
                required: ["code", "message", "activeCount", "maxActive"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  activeCount: { type: "integer" },
                  maxActive: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const body = request.body as { message: string; conversationId?: string };
      const session = await requireSession(organizationId, deps);
      try {
        const result = await processCeoMessage(
          session,
          body.message,
          body.conversationId,
          deps.marketing,
          deps.engineRuntimePolicy,
        );
        return reply.code(200).send(result);
      } catch (cause) {
        if (cause instanceof MaxActiveConversationsError) {
          return reply.code(409).send({
            error: {
              code: "MAX_ACTIVE_CONVERSATIONS",
              message: cause.message,
              activeCount: cause.activeCount,
              maxActive: MAX_ACTIVE_CONVERSATIONS_VALUE,
            },
          });
        }
        throw cause;
      }
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
      const session = await requireSession(organizationId, deps);
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

/**
 * Hierarchical conversation context for the model.
 *
 *   [conversation.summary]  ← older material, deterministic, no-LLM
 *   [recent verbatim]       ← bounded window of the most recent turns
 *
 * Raw messages stay in `conversation_messages` (durable, recoverable). The
 * model never sees the entire transcript. The summary is DATA: the model
 * must not promote external/user text into company memory; that boundary
 * already lives in `rememberDepartment` which requires the explicit
 * `remember_fact` intent.
 */
export function assembleConversationContext(
  conversation: ConversationRecord,
  recentMessages: readonly ConversationMessage[],
): {
  summary: string | undefined;
  recent: { role: "user" | "assistant"; content: string }[];
} {
  return {
    summary: conversation.summary,
    recent: recentMessages.map((m) => ({ role: m.role, content: m.content })),
  };
}

/** Serializes the hierarchical context into a single string the model
 *  receives as the historical part of the prompt. */
export function serializeContextForModel(input: {
  summary?: string;
  recent: { role: "user" | "assistant"; content: string }[];
  extraContext?: string;
}): string {
  const parts: string[] = [];
  if (input.summary) {
    parts.push(`Resumen (más antiguo, no reciente):\n${input.summary}`);
  }
  if (input.recent.length > 0) {
    const lines = input.recent.map(
      (m) => `- ${m.role === "user" ? "CEO" : "DEPARTIFY"}: ${m.content}`,
    );
    parts.push(`Mensajes recientes (verbatim):\n${lines.join("\n")}`);
  }
  if (input.extraContext) {
    parts.push(input.extraContext);
  }
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
  dnaStore: CompanyDnaStore,
): Promise<void> {
  const progress = session.state.progress;
  if (!progress) return;
  const onboarding = session.state.onboarding;
  if (!onboarding) return;

  try {
    checkpoint("research_started", session.organizationId);
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

    // Customer Zero P0 — the research output becomes DURABLE Company DNA.
    // Only what the research genuinely found is written: an
    // interpretation that discovered no products leaves `products`
    // empty and the gap surfaces honestly through the completeness
    // contract instead of being papered over.
    const existing = await dnaStore.get(session.organizationId);
    if (existing) {
      await dnaStore.upsert(
        projectResearchToDna(existing, interpreted, new Date().toISOString()),
      );
    }
    checkpoint("research_completed", session.organizationId);
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
    [...session.state.connections.keys()],
  );
}

/**
 * P-B: read/entry paths auto-create the session and hydrate durable tool
 * state, so a Railway restart never strands an existing organization (no
 * 404 → portal reset loop, connections survive).
 */
export const MAX_ACTIVE_CONVERSATIONS_VALUE = 5;

/** The 6th active conversation is REFUSED, never silently deleted. The
 *  portal renders a friendly archive-first dialog from this error. */
export class MaxActiveConversationsError extends Error {
  readonly activeCount: number;
  constructor(activeCount: number) {
    super(
      "Ya tienes 5 conversaciones activas. Archiva una para empezar otra.",
    );
    this.name = "MaxActiveConversationsError";
    this.activeCount = activeCount;
  }
}

export async function requireSession(
  organizationId: string,
  deps: ServerDeps,
): Promise<CustomerZeroSession> {
  const session = getOrCreateCustomerZeroSession(organizationId, {
    ...(deps.toolState ? { toolState: deps.toolState } : {}),
    ...(deps.conversations ? { conversations: deps.conversations } : {}),
  });
  await hydrateSessionToolState(session);
  // Customer Zero P0 — rebuild the company understanding from DURABLE
  // storage. After a Railway restart the session Map is empty; without
  // this the department context compiler would rebuild an empty company
  // and Elvira would greet a CEO she no longer recognises.
  await hydrateSessionFromCompanyDna(session, resolveCompanyDnaStore(deps));
  // STATE-MACHINE INVARIANT: "connecting" is only valid while the OAuth
  // state nonce is alive (10 minutes). If a Google connection is still
  // "connecting" with a missing/expired/consumed nonce (the callback
  // never arrived — e.g. the browser dropped the callback page), the
  // connection MUST leave "connecting" and surface an actionable
  // terminal state. Never "connecting" forever.
  await reapStaleGoogleHandshakes(session);
  return session;
}

const GOOGLE_TOOL_IDS = new Set([
  "gmail",
  "google_workspace",
  "google_calendar",
  "google_drive",
]);

/**
 * Transition a Google connection out of "connecting" into an actionable
 * terminal state (blocked / needs_connection). Shared by the callback
 * failure paths and the stale-handshake reaper.
 */
function transitionGoogleConnectionToTerminal(
  connection: ConnectionState,
  reason: string,
): void {
  connection.status = "blocked";
  connection.lifecycle = "needs_connection";
  connection.blockedReason = reason;
  delete connection.authorizationUrl;
  delete connection.oauthState;
}

/**
 * For every Google connection still in status "connecting", verify the
 * OAuth state nonce is still alive in the durable store. Missing,
 * expired or already-consumed nonces mean the handshake will never
 * complete → transition to a terminal state and persist it.
 */
async function reapStaleGoogleHandshakes(
  session: CustomerZeroSession,
): Promise<void> {
  let changed = false;
  for (const [toolId, connection] of session.state.connections) {
    if (!GOOGLE_TOOL_IDS.has(toolId)) continue;
    if (connection.status !== "connecting") continue;
    const nonce = connection.oauthState;
    let alive = false;
    if (nonce) {
      try {
        const record = await getGoogleOAuthStateStore().get(nonce);
        alive = Boolean(record && !record.consumed);
      } catch {
        alive = false;
      }
    }
    if (!alive) {
      transitionGoogleConnectionToTerminal(
        connection,
        "La autorización de Google no se completó o expiró. Vuelve a intentarlo.",
      );
      await persistToolState(
        session,
        toolStateFromConnection(session, connection),
      );
      changed = true;
    }
  }
  if (changed) {
    // Log safely: no tokens, no nonce, no secrets.
    console.log("[google-oauth] stale handshake reaped");
  }
}

/** Result of processing one CEO message within a durable conversation. */
export interface CeoMessageResult {
  readonly organizationId: string;
  readonly reply: string;
  readonly events: readonly CommandCenterEvent[];
  readonly routing: RoutingDecision;
  readonly connectionSuggestion: ConnectionSuggestion | null;
  readonly pendingToolId: string | null;
  readonly conversationId: string;
}

/**
 * P-B part 15 — one authoritative chat turn. The user message and the
 * assistant reply are persisted to a durable, organization-scoped
 * conversation. The LLM context uses a BOUNDED window of recent messages, not
 * an ever-growing transcript. Company memory (department memories, DNA) is
 * intentionally separate from conversation history.
 */
type MarketingServiceType = MarketingService;

export async function processCeoMessage(
  session: CustomerZeroSession,
  message: string,
  conversationId?: string,
  marketing?: MarketingServiceType,
  engineRuntimePolicy?: "strict" | "legacy-fallback",
): Promise<CeoMessageResult> {
  let conversation: ConversationRecord;
  try {
    conversation = await ensureConversation(session, message, conversationId);
  } catch (cause) {
    if (cause instanceof MaxActiveConversationsError) {
      // Surface the structured cap-error to the caller so every
      // /command-center/message ingress delivers the same payload as
      // /conversations. Portal switches from a transient inline error
      // to the archive-first dialog.
      throw cause;
    }
    throw cause;
  }
  const organizationId = session.organizationId;

  await session.conversations.addMessage(conversation.id, "user", message);

  const input = buildCommandCenterInput(session, message);
  const routed = routeCommandCenter(input);

  const isEs = session.state.locale !== "en";
  let assistantReply = routed.reply;
  let marketingTurn: { role: "user" | "assistant"; content: string } | null = null;
  // Customer Zero Email P0 — when the email pipeline surfaces a
  // "Conecta tu correo" contextual card, it travels on this field so the
  // portal renders it as a connection_need event for THIS turn.
  let emailConnectionSuggestion: ConnectionSuggestion | null = null;
  // Set when the turn actually dispatched a Mautic tool execution
  // (vs. a Gmail read). Drives the work-state pills so a Gmail read
  // never claims "Consultando Mautic…".
  let mauticDispatched = false;

  // Customer Zero Email P0 — the email action pipeline. Runs for BOTH
  // fresh email requests (intent === "email_action") AND continuations
  // of a pending email (session.state.pendingEmailWork). It NEVER
  // depends on the engine/LLM: email work is deterministic, fast, and
  // multi-turn — a follow-up like "Son A, B y C" continues the SAME
  // pending email instead of falling into a generic route or timing out
  // into the generic red error.
  if (routed.decision.intent === "email_action" || session.state.pendingEmailWork) {
    const emailOutcome = await runEmailTurn(session, message, isEs);
    assistantReply = emailOutcome.reply;
    marketingTurn = { role: "assistant", content: emailOutcome.reply };
    emailConnectionSuggestion = emailOutcome.connectionSuggestion;
  } else if (routed.decision.intent === "delegate_marketing") {
    // ENGINE 03: when the MarketingService is wired (EngineAdapter available),
    // Elvira's reply comes from the engine boundary.
    //
    // DEPLOY 01 (strict): when policy is "strict" and the engine path is
    // wired, an engine failure must FAIL CLEARLY — never silently fall back to
    // the legacy runtime. The CEO sees a clean, business-language unavailable
    // message and observability records the failure.
    if (marketing) {
      try {
        const outcome = await marketing.talkToElvira({
          organizationId,
          message,
          locale: session.state.locale,
        });
        if (outcome.reply && outcome.reply.trim().length > 0) {
          assistantReply = outcome.reply;
          marketingTurn = { role: "assistant", content: outcome.reply };
        }
      } catch {
        if (engineRuntimePolicy === "strict") {
          // No legacy fallback: report Marketing as temporarily unavailable.
          const isEs = session.state.locale !== "en";
          assistantReply = isEs
            ? "Marketing no está disponible temporalmente. Inténtalo de nuevo en unos minutos."
            : "Marketing is temporarily unavailable. Please try again in a few minutes.";
          marketingTurn = { role: "assistant", content: assistantReply };
        }
        // In legacy-fallback mode (dev/test), keep the routing reply.
      }
    } else {
      try {
        const recentMessages = await session.conversations.listMessages(
          organizationId,
          conversation.id,
          20,
        );
        // Hierarchical context: [compaction summary] + [recent verbatim]
        // Raw historical messages stay in conversation_messages and are
        // reachable by retrieval / history endpoints, but the model never
        // receives the entire transcript. This is the boundary: chat
        // history is NOT company memory.
        const ctx = assembleConversationContext(conversation, recentMessages);
        const outcome = await session.port.executeAction({
          actionId: `act_cc_${shortId()}`,
          agentId: "agent_marketing_director",
          organizationId,
          toolId: "marketing.chat",
          args: {
            organizationId,
            message,
            history: ctx.recent,
            summary: ctx.summary,
            extraContext: serializeContextForModel({
              ...(ctx.summary ? { summary: ctx.summary } : {}),
              recent: ctx.recent,
              extraContext: buildMemoryContextForChat(session),
            }),
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
    // Email-aware dispatch: an email READ question resolves the org's
    // operational EMAIL provider (corporate IMAP first, Google as the
    // default identity) and reads real inbox data through it. Falls
    // through to the Mautic dispatch otherwise.
    if (isEmailQuestion(message)) {
      const provider = await resolveOperationalEmailProvider(
        organizationId,
      );
      if (provider) {
        try {
          const emailReply = await readEmailAnswer(
            organizationId,
            message,
            session.state.locale,
          );
          if (emailReply) {
            assistantReply = emailReply;
            marketingTurn = { role: "assistant", content: assistantReply };
          }
        } catch {
          assistantReply = isEs
            ? "No he podido consultar tu correo. Vuelve a intentarlo en unos minutos."
            : "I could not query your email right now. Please try again in a few minutes.";
          marketingTurn = { role: "assistant", content: assistantReply };
        }
      } else {
        assistantReply = isEs
          ? "Tu correo todavía no está conectado. Ve a Conexiones para conectarlo y vuelvo a intentarlo."
          : "Your email is not connected yet. Go to Connections to connect it and I'll try again.";
        marketingTurn = { role: "assistant", content: assistantReply };
      }
    } else {
    const mauticConn = session.state.connections.get("mautic");
    const mauticLifecycle: ToolLifecycleStatus =
      mauticConn?.lifecycle ??
      (mauticConn?.status === "connected" ? "connected" : "needs_connection");

    if (mauticLifecycle !== "connected") {
      assistantReply = mauticNotOperationalReply(mauticLifecycle, isEs);
      marketingTurn = { role: "assistant", content: assistantReply };
    } else {
      mauticDispatched = true;
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
  }

  // Customer Zero 01 P0 — durable long-analysis. When the CEO asks
  // for an analysis + report, route through the DepartmentWorkExecutor
  // so the work is durable, observable, and the final message is
  // auto-injected into the conversation (no "¿ya está?" required).
  const mauticConnForP0 = session.state.connections.get("mautic");
  const mauticLifecycleForP0: ToolLifecycleStatus =
    mauticConnForP0?.lifecycle ??
    (mauticConnForP0?.status === "connected" ? "connected" : "needs_connection");
  if (
    routed.decision.intent === "external_tool_query" &&
    mauticLifecycleForP0 === "connected"
  ) {
    const asksForAnalysis = /\b(analiz[ae]r?|informe|report[ae]|resum[ie]n|prepara(r)?|deja(r)?\s+en\s+resultados)\b/i.test(
      message,
    );
    if (asksForAnalysis) {
      try {
        const executor = createWorkExecutor(organizationId);
        const outcome = await executor.run({
          organizationId,
          conversationId: conversation.id,
          departmentId: "marketing",
          objectiveId: null,
          requestedBy: "ceo",
          title: t(
            session.state.locale,
            `Análisis de contactos de Mautic`,
            `Mautic contacts analysis`,
          ),
          summary: t(
            session.state.locale,
            `Resumen de contactos de Mautic`,
            `Mautic contacts summary`,
          ),
          capability: "crm.contacts.summary",
          locale: session.state.locale,
        });
        // Auto-inject the final message into the conversation and
        // override the assistant reply with the same content.
        await session.conversations.addMessage(
          conversation.id,
          "assistant",
          outcome.finalMessage,
        );
        assistantReply = outcome.finalMessage;
        marketingTurn = { role: "assistant", content: assistantReply };
      } catch {
        // Executor already records the failure and emits a final
        // message; nothing to do here.
      }
    }
  }

  await session.conversations.addMessage(
    conversation.id,
    "assistant",
    marketingTurn?.content ?? assistantReply,
  );

  // Legacy in-memory transcript (kept for back-compat; NOT the source of
  // truth — durable conversations are).
  session.state.conversation = [
    ...session.state.conversation,
    { role: "user", content: message },
    marketingTurn ?? { role: "assistant", content: assistantReply },
  ];

  // Per-turn events: ONLY the events that actually happened this
  // turn (the assistant transcript + work-state pills when real
  // work was delegated). The proactive opening event is fetched
  // via the separate /command-center/opening endpoint and MUST NOT
  // be appended on every message — that would re-summon "Elvira
  // toma la iniciativa" after every CEO message.
  const events: CommandCenterEvent[] = [];

  // Customer Zero 01 — chat enrichment. The portal now renders the
  // assistant reply with the correct speaker identity (DEPARTIFY vs
  // ELVIRA · Directora de Marketing) and a live work-state strip that
  // reflects the real routing decision + whether the engine call
  // succeeded. No fake timers; if a state did not occur, no event is
  // emitted.
  const enrichment = enrichForChat({
    intent: routed.decision.intent,
    // Email actions are direct Departify work, not Elvira delegation —
    // no "Enviado a Elvira" pills for the email pipeline.
    marketingInvoked:
      routed.decision.intent === "email_action"
        ? false
        : marketingTurn !== null ||
          routed.decision.intent === "delegate_marketing",
    marketingSucceeded: marketingTurn !== null,
    locale: session.state.locale,
    reply: assistantReply,
    mauticToolUsed: mauticDispatched,
    connectionBlocked:
      routed.decision.intent === "external_tool_query" &&
      (() => {
        const conn = session.state.connections.get("mautic");
        if (!conn) return true;
        const lifecycle =
          conn.lifecycle ?? (conn.status === "connected" ? "connected" : "needs_connection");
        return lifecycle !== "connected";
      })(),
  });

  const transcriptEvent: CommandCenterEvent = {
    kind: "transcript",
    role: "assistant",
    content: enrichment.normalizedReply,
    speaker: enrichment.speaker,
  };

  const workStateEvents = buildWorkStateEvents(
    enrichment.workStates,
    session.state.locale,
  );

  // Front of the events list: the new assistant turn + its work states.
  // The proactive opening is kept as context after the new turn so the
  // chat continues to feel alive without overriding the latest reply.
  return {
    organizationId,
    reply: enrichment.normalizedReply,
    events: [transcriptEvent, ...workStateEvents, ...events],
    routing: routed.decision,
    connectionSuggestion:
      emailConnectionSuggestion ?? routed.connectionSuggestion ?? null,
    pendingToolId: routed.pendingToolId ?? null,
    conversationId: conversation.id,
  };
}

/** Resolves (and creates when needed) the conversation a turn belongs to. */
export async function ensureConversation(
  session: CustomerZeroSession,
  message: string,
  conversationId?: string,
): Promise<ConversationRecord> {
  const organizationId = session.organizationId;

  if (conversationId) {
    const existing = await session.conversations.get(organizationId, conversationId);
    if (existing) {
      session.state.currentConversationId = existing.id;
      await renameIfUntitled(session, existing, message);
      return existing;
    }
  }

  if (session.state.currentConversationId) {
    const current = await session.conversations.get(
      organizationId,
      session.state.currentConversationId,
    );
    if (current) {
      await renameIfUntitled(session, current, message);
      return current;
    }
  }

  const recent = await session.conversations.listForOrg(organizationId);
  if (recent[0]) {
    session.state.currentConversationId = recent[0].id;
    await renameIfUntitled(session, recent[0], message);
    return recent[0];
  }

  // P-B part 26 — refuse to auto-create a 6th active conversation.
  // Portal surfaces the cap dialog; the underlying create is never
  // silent. The limit is enforced here so EVERY ingress path (POST
  // /conversations, POST /command-center/message, POST .../messages)
  // honours the same contract.
  const activeCount = await session.conversations.countActiveForOrg(
    organizationId,
  );
  if (activeCount >= MAX_ACTIVE_CONVERSATIONS_VALUE) {
    throw new MaxActiveConversationsError(activeCount);
  }

  const created = await session.conversations.create(
    organizationId,
    DEFAULT_CONVERSATION_TITLE,
  );
  session.state.currentConversationId = created.id;
  await renameIfUntitled(session, created, message);
  return created;
}

async function renameIfUntitled(
  session: CustomerZeroSession,
  conversation: ConversationRecord,
  message: string,
): Promise<void> {
  if (conversation.title !== DEFAULT_CONVERSATION_TITLE) return;
  await session.conversations.rename(
    session.organizationId,
    conversation.id,
    deriveConversationTitle(message),
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
    // Customer Zero P0 — the legacy `handoff` terminal is GONE. When no
    // question remains the next product stage is the understanding /
    // confirmation review, driven by the canonical readiness stage — never
    // a "Ya tengo suficiente / Vamos a trabajar" dead end.
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
 * Capability-first: the CEO's tool answers become durable, organization-scoped
 * declarations. Selection NEVER means connected: the lifecycle is derived from
 * real configuration + verification.
 */
async function registerTools(
  session: CustomerZeroSession,
  values: readonly string[],
  locale: SupportedLocale,
): Promise<void> {
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
    await declareCatalogTool(session, tool);
  }
}

/** Honest, lifecycle-aware Mautic answer when it is NOT operationally usable. */
function mauticNotOperationalReply(
  lifecycle: ToolLifecycleStatus,
  isEs: boolean,
): string {
  switch (lifecycle) {
    case "configured":
      return isEs
        ? "Mautic está configurado pero todavía no se ha verificado la conexión. Puedes verificarla en Conexiones y enseguida consulto los contactos."
        : "Mautic is configured but the connection has not been verified yet. You can verify it in Connections and I will check the contacts right away.";
    case "degraded":
    case "unavailable":
      return isEs
        ? "Ahora mismo hay un problema de conexión con Mautic. Cuando se recupere, podré consultar los contactos."
        : "There is currently a connection problem with Mautic. Once it recovers, I can look up the contacts.";
    case "needs_connection":
    case "selected":
    default:
      return isEs
        ? "Para responderte necesito acceder a Mautic. Todavía no está conectado. Puedes conectarlo en Conexiones."
        : "To answer that I need access to Mautic. It is not connected yet. You can connect it in Connections.";
  }
}

/* ----------------------------------------------------------------------------
 * Gmail dispatch — the only path that performs a real Gmail read.
 *
 * The CEO's question lands here when:
 *
 *   - the routing decided `external_tool_query`, AND
 *   - the message is about email / Gmail / inbox / unread / important / etc.
 *
 * If Gmail is operational (durable refresh token + operational probe),
 * a real Gmail search is performed and a business-readable Spanish
 * summary is returned. If Gmail is NOT operational, an honest
 * recovery action is surfaced. The reply NEVER hallucinates results.
 *
 * The reply NEVER contains token VALUES, the user's OAuth scopes as
 * raw strings, or provider internals. The CEO sees only what they
 * would say to a colleague.
 * --------------------------------------------------------------------------*/

const EMAIL_QUESTION_PATTERN = new RegExp(
  [
    // P0 — bare "mail" must match. The previous regex missed it and the
    // message fell through to the Mautic branch instead of runGmailRead.
    // `\bmail\b` does NOT match "mailchimp" (one word, no boundary).
    "\\b(correos?|emails?|mail|mailbox|inbox|bandeja|buz[oó]n|buz[oó]n\\s+de\\s+entrada)",
    "important|importantes|unread|no\\s+le[ií]dos?|pendientes",
    "responder|respuesta|respu[eé]stame",
    "gmail|google\\s+mail|googlemail",
  ].join("|"),
  "i",
);

function isEmailQuestion(message: string): boolean {
  return EMAIL_QUESTION_PATTERN.test(message);
}

/**
 * Customer Zero Email P0 — the multi-turn email pipeline.
 *
 * Deterministic (no engine, no LLM): the CEO's email request is parsed
 * into recipient + objective, missing fields are asked for in business
 * language, the draft is shown for approval, and the send goes through
 * the org's operational email provider. Every turn persists the pending
 * state on the session so the next message continues the SAME work.
 *
 * Never fakes success. Never leaks credentials. The draft body is
 * treated as DATA (prompt-injection boundary).
 */
async function runEmailTurn(
  session: CustomerZeroSession,
  message: string,
  isEs: boolean,
): Promise<{ reply: string; connectionSuggestion: ConnectionSuggestion | null }> {
  const locale = session.state.locale;
  let work = session.state.pendingEmailWork;

  // Fresh email request → start (or restart) the pending work.
  if (isEmailSendRequest(message)) {
    work = createPendingEmailWork();
    const recipient = extractRecipient(message);
    const objective = extractObjective(message);
    work.recipient = recipient;
    work.objective = objective;
    recomputeMissingFields(work);
    session.state.pendingEmailWork = work;
    if (work.missingFields.length > 0) {
      // Ask for the missing business fields immediately — do NOT let the
      // continuation branch below re-absorb the request itself.
      return {
        reply: missingFieldsCopy(work.missingFields, locale),
        connectionSuggestion: null,
      };
    }
    // Complete request → draft + approval question.
    work.draft = buildEmailDraft(work.recipient!, work.objective!, locale);
    work.status = "awaiting_approval";
    return draftApprovalReply(work, isEs);
  }

  if (!work) {
    // Defensive: no pending work and not a send request — fall back to
    // the routing reply (should be unreachable given the gate).
    return { reply: "", connectionSuggestion: null };
  }

  // Awaiting approval → accept approve / cancel / new-info.
  if (work.status === "awaiting_approval" || work.status === "draft_ready") {
    if (isEmailCancellation(message)) {
      work.status = "cancelled";
      delete session.state.pendingEmailWork;
      return {
        reply: isEs
          ? "De acuerdo, he cancelado el correo. No se ha enviado nada."
          : "OK, I've cancelled the email. Nothing was sent.",
        connectionSuggestion: null,
      };
    }
    if (isEmailApprovalResponse(message)) {
      return sendPendingEmail(session, work, isEs);
    }
    // Not an approval: treat the message as additional objective info
    // and rebuild the draft.
    const objective = extractObjective(message) ?? message;
    work.objective = objective.trim();
    recomputeMissingFields(work);
    if (work.missingFields.length === 0) {
      work.draft = buildEmailDraft(work.recipient!, work.objective!, locale);
      work.status = "awaiting_approval";
      return draftApprovalReply(work, isEs);
    }
  }

  // Awaiting info → absorb the continuation into the missing fields.
  if (work.status === "awaiting_info") {
    if (!work.recipient) {
      const recipient = extractRecipient(message);
      if (recipient) work.recipient = recipient;
    }
    if (!work.objective) {
      // The continuation itself is the missing objective ("Son A, B y C").
      const objective = extractObjective(message) ?? message;
      work.objective = objective.trim();
    }
    recomputeMissingFields(work);
    if (work.missingFields.length > 0) {
      return {
        reply: missingFieldsCopy(work.missingFields, locale),
        connectionSuggestion: null,
      };
    }
    // Everything gathered → build the draft and ask for approval.
    work.draft = buildEmailDraft(work.recipient!, work.objective!, locale);
    work.status = "awaiting_approval";
    return draftApprovalReply(work, isEs);
  }

  // Missing info → ask in business language.
  if (work.missingFields.length > 0) {
    return {
      reply: missingFieldsCopy(work.missingFields, locale),
      connectionSuggestion: null,
    };
  }

  // Draft built but not yet approved.
  if (!work.draft) {
    work.draft = buildEmailDraft(work.recipient!, work.objective!, locale);
    work.status = "awaiting_approval";
    return draftApprovalReply(work, isEs);
  }

  return draftApprovalReply(work, isEs);
}

function recomputeMissingFields(work: PendingEmailWork): void {
  const missing: string[] = [];
  if (!work.recipient) missing.push("destinatario");
  if (!work.objective) missing.push("mensaje");
  work.missingFields = missing;
}

function draftApprovalReply(
  work: PendingEmailWork,
  isEs: boolean,
): { reply: string; connectionSuggestion: null } {
  work.status = "awaiting_approval";
  const draft = work.draft!;
  const intro = isEs
    ? "He preparado este correo:"
    : "I've prepared this email:";
  const draftLines = isEs
    ? [
        intro,
        "",
        `**Para:** ${draft.to}`,
        `**Asunto:** ${draft.subject}`,
        "",
        draft.body,
        "",
        isEs
          ? "¿Lo envío? Responde «sí, envíalo» para enviarlo, o dime qué quieres cambiar."
          : "Should I send it? Reply \"yes, send it\" to send, or tell me what to change.",
      ]
    : [
        intro,
        "",
        `**To:** ${draft.to}`,
        `**Subject:** ${draft.subject}`,
        "",
        draft.body,
        "",
        'Should I send it? Reply "yes, send it" to send, or tell me what to change.',
      ];
  return { reply: draftLines.join("\n"), connectionSuggestion: null };
}

/** Execute the send for an approved pending email. Never fakes success. */
async function sendPendingEmail(
  session: CustomerZeroSession,
  work: PendingEmailWork,
  isEs: boolean,
): Promise<{ reply: string; connectionSuggestion: ConnectionSuggestion | null }> {
  const organizationId = session.organizationId;
  // Guard: if the connection disappeared, go back to a contextual
  // "Conecta tu correo" state instead of failing with a red error.
  if (!work.draft) {
    work.status = "awaiting_info";
    recomputeMissingFields(work);
    return {
      reply: isEs
        ? "Todavía no tengo el contenido del correo. Dime qué quieres decir."
        : "I don't have the email content yet. Tell me what you want to say.",
      connectionSuggestion: null,
    };
  }
  const operational = await isEmailCapabilityOperational(organizationId);
  if (!operational) {
    work.status = "awaiting_approval";
    return {
      reply: isEs
        ? "Tu correo todavía no está conectado, así que no puedo enviarlo. Conecta tu correo en Conexiones y volveré a intentarlo con el borrador que ya tengo."
        : "Your email is not connected yet, so I can't send it. Connect your email in Connections and I'll retry with the draft I already have.",
      connectionSuggestion: buildEmailConnectionSuggestion(isEs),
    };
  }
  work.status = "sending";
  const outcome = await sendEmail(session, {
    to: work.draft.to,
    subject: work.draft.subject,
    bodyText: work.draft.body,
  });
  if (outcome.ok) {
    work.status = "sent";
    work.provider = outcome.provider;
    work.sendResult = {
      provider: outcome.provider ?? "unknown",
      recipient: work.draft.to,
      sentAt: outcome.sentAt ?? new Date().toISOString(),
      providerMessageId: outcome.providerMessageId,
    };
    delete session.state.pendingEmailWork;
    return {
      reply: isEs
        ? `Enviado a ${work.draft.to}.`
        : `Sent to ${work.draft.to}.`,
      connectionSuggestion: null,
    };
  }
  // Failed send: keep the draft, surface an actionable recovery.
  work.status = "awaiting_approval";
  const hint = isEs
    ? "No he podido enviar el correo ahora mismo. Vuelve a intentarlo en unos minutos; el borrador sigue preparado."
    : "I couldn't send the email right now. Try again in a few minutes; the draft is still ready.";
  return { reply: hint, connectionSuggestion: null };
}

/** Contextual "Conecta tu correo" suggestion — product wording, never
 *  provider jargon. */
function buildEmailConnectionSuggestion(
  isEs: boolean,
): ConnectionSuggestion {
  return {
    toolId: "email",
    label: isEs ? "Correo" : "Email",
    capability: "email.send.personal",
    why: isEs
      ? "Para enviar tus correos, Departify necesita acceso a tu correo de empresa."
      : "To send your emails, Departify needs access to your company email.",
    connectable: true,
    requiredCredentials: [],
    rawInput: "email",
  };
}

/**
 * Read the org's email through its operational provider (corporate
 * IMAP first, Google as the default identity) and render a clean,
 * intent-aware business summary. Never exposes query syntax or
 * provider internals.
 */
async function readEmailAnswer(
  organizationId: string,
  message: string,
  locale: SupportedLocale,
): Promise<string | null> {
  const provider = await resolveOperationalEmailProvider(organizationId);
  if (provider === "corporate") {
    return readCorporateEmailAnswer(organizationId, message, locale);
  }
  if (provider === "google") {
    return runGmailRead(organizationId, message, locale);
  }
  return null;
}

async function readCorporateEmailAnswer(
  organizationId: string,
  message: string,
  locale: SupportedLocale,
): Promise<string | null> {
  const isEs = locale !== "en";
  const summaries = await getCorporateEmailStore().listForOrg(organizationId);
  const target = summaries.find((s) => s.operationalVerifiedAt !== null);
  if (!target) return null;
  const account = await getCorporateEmailStore().get(
    organizationId,
    target.userId,
  );
  if (!account) return null;
  const { readCorporateInbox } = await import(
    "../../customer-zero/corporate-email-adapter.js"
  );
  const plan = gmailDeriveReadPlan(message);
  const raw = await readCorporateInbox(account, plan.maxResults);
  if (raw.length === 0) {
    return isEs
      ? "No he encontrado correos recientes en tu bandeja. Si esperabas algo concreto, dime el remitente o el tema y lo busco."
      : "I didn't find recent emails in your inbox. If you were expecting something specific, share the sender or topic and I'll search.";
  }
  const items = raw.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    sender: m.from.displayName
      ? `${m.from.displayName} <${m.from.email}>`
      : m.from.email,
    senderEmail: m.from.email,
    subject: m.subject || (isEs ? "(sin asunto)" : "(no subject)"),
    receivedAt: m.date,
    snippet: m.snippet,
    unread: m.isUnread,
  }));
  return renderGmailSummary({
    intent: plan.intent,
    items,
    locale,
    totalFound: items.length,
  });
}

async function runGmailRead(
  organizationId: string,
  message: string,
  locale: SupportedLocale,
): Promise<string | null> {
  const isEs = locale !== "en";
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  const { GmailAdapter } = await import("../../customer-zero/gmail-adapter.js");
  // The CEO's session user id is unknowable here in this prototype
  // path. The durable store is keyed by (org, user); we pick the
  // first operational row for the org. The adapter itself uses
  // getTokens() which queries the durable store.
  const summaries = await getGoogleTokenStore().listForOrg(organizationId);
  const target = summaries.find(
    (s) => s.hasRefreshToken && s.operationalVerifiedAt,
  );
  if (!target) return null;
  const adapter = new GmailAdapter(
    { organizationId, userId: target.userId },
    clientId,
    clientSecret,
  );
  const query = gmailDeriveReadPlan(message).query;
  const maxResults = gmailDeriveReadPlan(message).maxResults;
  const result = await adapter.searchMessages(query, maxResults);
  if (result.success && result.value) {
    const plan = gmailDeriveReadPlan(message);
    const items = result.value.map(summarizeGmailMessage);
    return renderGmailSummary({
      intent: plan.intent,
      items,
      locale,
      totalFound: items.length,
    });
  }
  // Gmail API did not respond correctly (auth / rate limit / down).
  // Honest, actionable recovery — never a fabricated inbox.
  return isEs
    ? "No he podido leer tu Gmail ahora mismo: la API de Gmail no respondió correctamente. Vuelve a intentarlo en unos minutos; si el problema persiste, revisa la conexión en Conexiones."
    : "I couldn't read your Gmail right now: the Gmail API did not respond correctly. Try again in a few minutes; if the issue persists, review the connection in Connections.";
}

function publicBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
}

/** The /conexiones view: catalog availability + durable lifecycle. */
export interface ToolConnectionView {
  readonly toolId: string;
  readonly label: string;
  readonly capability: string;
  readonly category: string;
  /** Business domains this tool belongs to (primary first). */
  readonly domains: readonly ToolDomain[];
  /** "available" when the org has no state for the tool. */
  readonly state: ToolLifecycleStatus | "available";
  readonly hasState: boolean;
  readonly humanLabel: string;
  readonly action: "prepare" | "connect" | "verify" | "retry" | null;
  readonly verifiedAt?: string;
  readonly blockedReason?: string;
}

/**
 * The full /conexiones surface: every catalog tool with its organization
 * state. "Not selected during onboarding" means AVAILABLE, not absent.
 *
 * Gmail + Workspace + Calendar + Drive share ONE durable refresh-token
 * row. /conexiones and the chat pipeline MUST read that row, otherwise
 * the connection card says "conectado" while the chat says
 * "preparando". The durable row is the source of truth; the in-memory
 * connection.status is a UI hint.
 */
async function buildCatalogConnectionViews(
  session: CustomerZeroSession,
  locale: SupportedLocale,
): Promise<ToolConnectionView[]> {
  const connected = session.state.connections;
  const googleOperational = await googleOperationalFor(session.organizationId);
  return TOOL_CATALOG.map((tool) => {
    const connection = connected.get(tool.id);
    const category = locale === "en" ? tool.categoryEn : tool.categoryEs;
    if (!connection) {
      return {
        toolId: tool.id,
        label: tool.label,
        capability: tool.capability,
        category,
        domains: domainsFor(tool.id),
        state: "available",
        hasState: false,
        humanLabel: t(locale, "Disponible", "Available"),
        action: "prepare",
      };
    }
    let lifecycle: ToolLifecycleStatus =
      connection.lifecycle ??
      (connection.status === "connected" ? "connected" : "needs_connection");
    const googleToolIds = new Set([
      "gmail",
      "google_workspace",
      "google_calendar",
      "google_drive",
    ]);
    if (
      googleToolIds.has(tool.id) &&
      googleOperational &&
      lifecycle !== "connected"
    ) {
      // Promote from needs_connection to connected because the
      // durable refresh-token row is operational.
      lifecycle = "connected";
    }
    // Semantic consistency: a tool with no implemented connector can never be
    // "needs_connection" (the CEO has no mechanism to connect it). It is
    // SELECTED. CONNECTED/CONFIGURED are kept as-is defensively.
    const consolidatedLifecycle: ToolLifecycleStatus = hasWorkingConnector(tool.id)
      ? lifecycle
      : lifecycle === "connected" || lifecycle === "configured"
        ? lifecycle
        : "selected";
    return {
      toolId: tool.id,
      label: tool.label,
      capability: tool.capability,
      category,
      domains: domainsFor(tool.id),
      state: consolidatedLifecycle,
      hasState: true,
      humanLabel: humanLifecycleLabel(consolidatedLifecycle, locale),
      action: catalogAction(tool, consolidatedLifecycle),
      ...(connection.verifiedAt ? { verifiedAt: connection.verifiedAt } : {}),
      ...(connection.blockedReason ? { blockedReason: connection.blockedReason } : {}),
    };
  });
}

/**
 * Cached lookup of the durable Google identity for an organization.
 * The connection card and the chat pipeline share this single
 * source of truth.
 */
const googleOperationalCache = new Map<
  string,
  { operational: boolean; ts: number }
>();
async function googleOperationalFor(
  organizationId: string,
): Promise<boolean> {
  const cached = googleOperationalCache.get(organizationId);
  if (cached && Date.now() - cached.ts < 5_000) return cached.operational;
  const operational = await hasOperationalGoogleIdentityForOrg(
    organizationId,
  );
  googleOperationalCache.set(organizationId, { operational, ts: Date.now() });
  return operational;
}

/** Test support: clears the operational-state cache between cases. */
export function resetGoogleOperationalCacheForTest(): void {
  googleOperationalCache.clear();
}

/** Only real actions: Mautic can verify/connect; everything else may be
 *  prepared (declared durably) but never fakes a connector. */
function catalogAction(
  tool: { id: string },
  lifecycle: ToolLifecycleStatus | "available",
): ToolConnectionView["action"] {
  if (lifecycle === "available") return "prepare";
  if (!hasWorkingConnector(tool.id)) return null;
  switch (lifecycle) {
    case "configured":
      return "verify";
    case "needs_connection":
    case "selected":
      return "connect";
    case "degraded":
    case "unavailable":
      return "retry";
    case "connected":
      return null;
  }
}

/** Declares a catalog tool for the organization (durable, never connected). */
async function declareCatalogTool(
  session: CustomerZeroSession,
  tool: ToolDescriptor,
): Promise<void> {
  if (session.state.connections.has(tool.id)) return;
  const declared = buildDeclaredToolState(
    session.organizationId,
    tool.id,
    tool.label,
    tool.capability,
  );
  session.state.connections.set(
    tool.id,
    buildConnectionStateWithLifecycle(tool, session.state.locale, declared.status, {
      ...(declared.configSource ? { configSource: declared.configSource } : {}),
    }),
  );
  await persistToolState(session, declared);
}

function toolStateFromConnection(
  session: CustomerZeroSession,
  connection: ConnectionState,
): OrganizationToolState {
  return {
    organizationId: session.organizationId,
    toolId: connection.toolId,
    label: connection.label,
    ...(connection.capability ? { capability: connection.capability } : {}),
    declared: true,
    status: connection.lifecycle ?? "needs_connection",
    ...(connection.configSource ? { configSource: connection.configSource } : {}),
    ...(connection.verifiedAt ? { verifiedAt: connection.verifiedAt } : {}),
    ...(connection.lifecycle === "connected"
      ? { health: "operational" as const }
      : connection.lifecycle === "degraded"
        ? { health: "degraded" as const }
        : connection.lifecycle === "unavailable"
          ? { health: "down" as const }
          : {}),
  };
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

/**
 * Customer Zero 01 — read all tool states for the session's
 * organization, defaulting to an empty list when none are stored.
 */
async function listToolStatesForSession(
  session: CustomerZeroSession,
): Promise<readonly OrganizationToolState[]> {
  return session.toolState.listForOrg(session.organizationId);
}

interface MauticTestResolution {
  readonly success: boolean;
  readonly available: boolean;
  readonly code: "auth" | "timeout" | "unavailable" | "rate_limit" | "invalid_response" | "missing";
  readonly message: string;
}

/**
 * Customer Zero 01 — test the live Mautic connection. Returns a
 * business-language resolution that the portal can render directly.
 * NEVER throws to the caller; never returns secret values.
 */
async function testMauticForOrg(
  session: CustomerZeroSession,
): Promise<MauticTestResolution> {
  const resolution = publicCredentialSource({
    organizationId: session.organizationId,
    provider: "mautic",
  });
  if (!resolution.available) {
    return {
      success: false,
      available: false,
      code: "missing",
      message:
        "Mautic no está configurado. Pídele a tu equipo de sistemas que añada las credenciales.",
    };
  }
  // Invoke the canonical test-connection tool through the runtime port.
  try {
    const outcome = await session.port.executeAction({
      actionId: `act_test_${shortId()}`,
      agentId: "agent_marketing_director",
      organizationId: session.organizationId,
      toolId: "mautic.test_connection",
      args: {},
    });
    if (outcome.status === "completed") {
      const output = outcome.output as
        | { success?: boolean; message?: string }
        | undefined;
      if (output?.success) {
        return {
          success: true,
          available: true,
          code: "invalid_response",
          message: output.message ?? "Conexión verificada.",
        };
      }
      return {
        success: false,
        available: true,
        code: "auth",
        message: output?.message ?? "La autenticación con Mautic ha fallado.",
      };
    }
    return {
      success: false,
      available: true,
      code: "unavailable",
      message: "Mautic no respondió a la prueba.",
    };
  } catch {
    return {
      success: false,
      available: true,
      code: "unavailable",
      message: "No se pudo conectar con Mautic.",
    };
  }
}

export type { ConnectionState };

/* ----------------------------------------------------------------------------
 * DepartmentWorkStore + DepartmentWorkExecutor factories.
 * --------------------------------------------------------------------------*/

let _workStoreSingleton: DepartmentWorkStore | null = null;
function getWorkStore(): DepartmentWorkStore {
  if (!_workStoreSingleton) {
    _workStoreSingleton = new InMemoryDepartmentWorkStore();
  }
  return _workStoreSingleton;
}

function createWorkExecutor(
  organizationId: string,
): DepartmentWorkExecutor {
  const session = getCustomerZeroSession(organizationId);
  if (!session) {
    throw new Error(`Session not found for org ${organizationId}`);
  }
  // P0 — the work executor only needs a write-capable activity
  // repository. The session keeps one in memory; we use a typed
  // cast since the session's activity store is itself a thin facade
  // over the same in-memory implementation.
  const activityRepo = (session as unknown as {
    activity?: {
      create: (entry: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  }).activity;
  const activityRepoFinal: MarketingActivityRepository = activityRepo
    ? (activityRepo as unknown as MarketingActivityRepository)
    : {
        async create(entry) {
          return {
            id: `act_${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            organizationId: organizationId,
            departmentId: "marketing",
            ...(entry.objectiveId ? { objectiveId: entry.objectiveId } : {}),
            actor: entry.actor,
            kind: entry.type,
            message: entry.message,
          } as unknown as Awaited<ReturnType<MarketingActivityRepository["create"]>>;
        },
        async listRecent() {
          return [];
        },
      };
  return new DepartmentWorkExecutor({
    workStore: getWorkStore(),
    activityRepo: activityRepoFinal,
    onMessageInjected: async (input) => {
      try {
        process.stdout.write(
          JSON.stringify({
            kind: "department.work.message_injected",
            ...input,
          }) + "\n",
        );
      } catch {
        // Observability is best-effort.
      }
    },
  });
}

/** Exposed for tests. */
export function __resetWorkStoreForTests(): void {
  _workStoreSingleton = null;
}

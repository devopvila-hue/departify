/**
 * Conversation routes — Phase P-B part 15 + 26.
 *
 * Durable, organization-scoped CEO chat sessions. Access goes through the
 * same P0-A tenant boundary (membership is enforced by the auth hook), and
 * every conversation operation is constrained to the organization id.
 *
 *   GET  /:org/conversations                          → list active (with activeCount + max)
 *   GET  /:org/conversations/history                  → list including archived (recoverable)
 *   POST /:org/conversations                          → create (title optional)
 *   GET  /:org/conversations/:conversationId          → record + messages
 *   POST /:org/conversations/:conversationId/messages  → send a CEO message (+ compaction)
 *   POST /:org/conversations/:conversationId/archive   → archive
 *
 * Hard rules:
 *   - Maximum 5 ACTIVE conversations. The 6th `POST /conversations` returns
 *     409 with a structured payload that the portal renders as
 *     "Ya tienes 5 conversaciones activas — archiva una para continuar".
 *     No silent deletion. Historical information survives.
 *   - Org isolation is structural: every operation carries
 *     `organizationId` and the store refuses cross-org access.
 *   - Compaction is run on demand, after the message add, when the
 *     transcript exceeds the threshold. Raw history is never deleted.
 *   - Archived conversations are recoverable from
 *     `/conversations/history` and never count toward the 5-active cap.
 */

import type { FastifyInstance } from "fastify";
import { performance } from "node:perf_hooks";
import {
  COMPACTION_THRESHOLD_CHARS,
  DEFAULT_CONVERSATION_TITLE,
  shouldCompact,
  splitForCompaction,
  summarizeOldMessages,
  type ConversationMessage,
} from "../../customer-zero/conversation-store.js";
import {
  buildCeoRuntimeForRequest,
  createCeoTurnTrace,
  emitCeoTurnTrace,
  ceoTurnResponseStatus,
  emitCeoTurnFailureTrace,
  traceRequestReceived,
  traceStage,
  processCeoMessage,
  requireSession,
  MaxActiveConversationsError,
  activityMessageFor,
} from "./customer-zero-v2.js";
import type { ServerDeps } from "../deps.js";

/** Maximum user-visible active conversations for any organization. */
export const MAX_ACTIVE_CONVERSATIONS = 5;

export async function registerConversationRoutes(
  server: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  server.get(
    "/api/customer-zero/:organizationId/conversations",
    {
      schema: {
        tags: ["command-center"],
        summary: "List the organization's active conversations",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: [
              "organizationId",
              "conversations",
              "activeCount",
              "maxActive",
            ],
            properties: {
              organizationId: { type: "string" },
              conversations: { type: "array" },
              activeCount: { type: "integer" },
              maxActive: { type: "integer" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const session = await requireSession(organizationId, deps);
      const canonical = await session.conversations.ensureCanonical(organizationId);
      const conversations = [canonical];
      return reply.code(200).send({
        organizationId,
        conversations,
        activeCount: 1,
        maxActive: 1,
      });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/conversations/history",
    {
      schema: {
        tags: ["command-center"],
        summary:
          "List archived legacy conversations for recovery; the portal uses one canonical thread.",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            required: ["organizationId", "conversations"],
            properties: {
              organizationId: { type: "string" },
              conversations: { type: "array" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const session = await requireSession(organizationId, deps);
      const conversations =
        await session.conversations.listForOrgIncludingArchived(organizationId);
      return reply.code(200).send({ organizationId, conversations });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/conversations",
    {
      schema: {
        tags: ["command-center"],
        summary: "Resolve the canonical conversation for the organization",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          201: {
            type: "object",
            required: ["conversation"],
            properties: {
              conversation: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
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
      const body = (request.body as { title?: string } | null | undefined) ?? {};
      const session = await requireSession(organizationId, deps);

      // Backward-compatible idempotent endpoint. The portal no longer offers
      // "Nueva conversación"; this route can only return the canonical CEO
      // thread and therefore cannot fork business context.
      const conversation = await session.conversations.ensureCanonical(
        organizationId,
        body.title?.trim() || DEFAULT_CONVERSATION_TITLE,
      );
      session.state.currentConversationId = conversation.id;
      return reply.code(201).send({ conversation });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/conversations/:conversationId",
    {
      schema: {
        tags: ["command-center"],
        summary: "A conversation with its full message history",
        params: {
          type: "object",
          required: ["organizationId", "conversationId"],
          properties: {
            organizationId: { type: "string" },
            conversationId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["conversation", "messages"],
            properties: {
              conversation: { type: "object", additionalProperties: true },
              messages: { type: "array" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, conversationId } = request.params as {
        organizationId: string;
        conversationId: string;
      };
      const session = await requireSession(organizationId, deps);
      const conversation = await session.conversations.get(
        organizationId,
        conversationId,
      );
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found." });
      }
      const query = (request.query as { limit?: string; before?: string } | undefined) ?? {};
      const page = await session.conversations.listMessagesPage(
        organizationId,
        conversationId,
        {
          limit: query.limit ? Number(query.limit) : 40,
          ...(query.before ? { before: query.before } : {}),
        },
      );
      session.state.currentConversationId = conversation.id;
      return reply.code(200).send({
        conversation,
        messages: page.messages,
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      });
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/conversations/:conversationId/messages",
    {
      schema: {
        tags: ["command-center"],
        summary: "Send a CEO message inside a durable conversation",
        params: {
          type: "object",
          required: ["organizationId", "conversationId"],
          properties: {
            organizationId: { type: "string" },
            conversationId: { type: "string" },
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
            required: ["organizationId", "reply", "events", "routing", "conversationId"],
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
          400: { type: "object", additionalProperties: true },
          429: { type: "object", additionalProperties: true },
          502: { type: "object", additionalProperties: true },
          503: { type: "object", additionalProperties: true },
          504: { type: "object", additionalProperties: true },
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
      const { organizationId, conversationId } = request.params as {
        organizationId: string;
        conversationId: string;
      };
      const { message } = request.body as { message: string };
      const startedMonotonicAt = performance.now();
      const correlationId = String(
        request.headers["x-departify-correlation-id"] ?? request.id,
      );
      const requestReceivedElapsedMs = traceRequestReceived(
        correlationId,
        organizationId,
        startedMonotonicAt,
      );
      const session = await requireSession(organizationId, deps);
      const trace = createCeoTurnTrace(session, correlationId, startedMonotonicAt);
      trace.timeline.T1_backend_request_received = requestReceivedElapsedMs;
      traceStage(trace, "T2_auth_tenant_resolution_complete");
      const conversation = await session.conversations.get(
        organizationId,
        conversationId,
      );
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found." });
      }
      session.state.currentConversationId = conversation.id;
      traceStage(trace, "T3_conversation_session_resolution_complete");
      let result;
      try {
        const runtime = await buildCeoRuntimeForRequest(
          session,
          deps,
          message,
          trace,
          request.authUser?.id,
        );
        result = await processCeoMessage(
          session,
          message,
          conversationId,
          deps.marketing,
          deps.engineRuntimePolicy,
          runtime,
          trace,
          deps,
          request.authUser?.id,
        );
      } catch (cause) {
        if (cause instanceof MaxActiveConversationsError) {
          return reply.code(409).send({
            error: {
              code: "MAX_ACTIVE_CONVERSATIONS",
              message: cause.message,
              activeCount: cause.activeCount,
              maxActive: 5,
            },
          });
        }
        emitCeoTurnFailureTrace(trace, cause);
        throw cause;
      }

      // After the message + assistant reply have been persisted, run
      // compaction if the transcript exceeds the provider-independent
      // character threshold. Raw history is preserved; only the model
      // context is rewritten to `[summary, ...recent]`.
      try {
        traceStage(trace, "T14_secondary_compaction_started");
        const persistedConversationId = result.conversationId || conversationId;
        const allMessages = await session.conversations.listMessages(
          organizationId,
          persistedConversationId,
        );
        const totalChars = allMessages.reduce(
          (sum, m) => sum + m.content.length,
          0,
        );
        if (shouldCompact(totalChars)) {
          const { older } = splitForCompaction(allMessages);
          const persisted = await session.conversations.get(
            organizationId,
            persistedConversationId,
          );
          const priorIndex = persisted?.compactedUpToMessageId
            ? allMessages.findIndex((message) => message.id === persisted.compactedUpToMessageId)
            : -1;
          const newOlder = older.filter((message) =>
            allMessages.findIndex((candidate) => candidate.id === message.id) > priorIndex,
          );
          if (newOlder.length > 0) {
            const lastFolded = newOlder[newOlder.length - 1] as ConversationMessage;
            const delta = summarizeOldMessages(
              newOlder.map((m) => ({ role: m.role, content: m.content })),
            );
            const summary = [persisted?.summary, delta].filter(Boolean).join("\n\n");
            await session.conversations.saveCompaction(
              organizationId,
              persistedConversationId,
              summary,
              lastFolded.id,
              (persisted?.compactionMessageCount ?? 0) + newOlder.length,
            );
          }
        }
        traceStage(trace, "T14_secondary_compaction_completed");
      } catch {
        traceStage(trace, "T14_secondary_compaction_failed", { errorClass: "secondary_write" });
        // Compaction is best-effort: a failure must NEVER break a CEO
        // turn. The bounded window continues to operate without a
        // summary until the next attempt.
      }

      traceStage(trace, "T15_backend_response_finalization", {
        responseStatus: ceoTurnResponseStatus(trace),
        finalTextBytes: Buffer.byteLength(result.reply, "utf8"),
      });
      emitCeoTurnTrace(session, trace, result);
      const responseStatus = ceoTurnResponseStatus(trace);
      if (responseStatus >= 400) {
        const errorCode = trace.engineErrorCode ?? "ENGINE_EXECUTION";
        return reply
          .header("x-departify-correlation-id", correlationId)
          .code(responseStatus)
          .send({
            error: {
              code: errorCode,
              message: "No he podido completar esa respuesta porque el motor de negocio ha fallado. Vuelve a intentarlo.",
              requestId: correlationId,
              statusCode: responseStatus,
            },
          });
      }
      return reply
        .header("x-departify-correlation-id", correlationId)
        .code(200)
        .send(result);
    },
  );

  /** Sprint 65 P0 — Live Activity streaming for ongoing conversations.
   *  Same pipeline as `/conversations/:conversationId/messages` but the
   *  activity events are pushed to the client as Server-Sent Events the
   *  moment they happen, so the CEO sees the same progressive product
   *  language ("Recibido" → "Revisando tu información" → "Marketing está
   *  trabajando" → "Escribiendo") on every conversation turn, not just
   *  on the opening one.
   *
   *  Wire format (text/event-stream) reuses the contract from
   *  /command-center/message/stream so the portal SSE parser works
   *  identically:
   *    event: activity\ndata: {work_state event}\n\n   (0..n, progressive)
   *    event: result\ndata: {CeoMessageResult}\n\n     (terminal, always last)
   *    event: error\ndata: {error object}\n\n          (terminal on failure)
   *
   *  Compaction runs after the engine result is streamed, just like the
   *  JSON endpoint. The activity stream is purely a transport concern;
   *  the canonical conversation state is still governed by the JSON
   *  endpoint — there is no second source of truth.
   */
  server.post(
    "/api/customer-zero/:organizationId/conversations/:conversationId/messages/stream",
    {
      schema: {
        tags: ["command-center"],
        summary:
          "Stream a CEO message inside a durable conversation with live activity events (SSE)",
        params: {
          type: "object",
          required: ["organizationId", "conversationId"],
          properties: {
            organizationId: { type: "string" },
            conversationId: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: ["message"],
          properties: { message: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        response: {
          200: { type: "string" },
          404: { type: "object", properties: { error: { type: "string" } } },
          400: { type: "object", additionalProperties: true },
          429: { type: "object", additionalProperties: true },
          502: { type: "object", additionalProperties: true },
          503: { type: "object", additionalProperties: true },
          504: { type: "object", additionalProperties: true },
          409: { type: "object", additionalProperties: true },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, conversationId } = request.params as {
        organizationId: string;
        conversationId: string;
      };
      const body = request.body as { message: string };
      const startedMonotonicAt = performance.now();
      const correlationId = String(
        request.headers["x-departify-correlation-id"] ?? request.id,
      );
      const requestReceivedElapsedMs = traceRequestReceived(
        correlationId,
        organizationId,
        startedMonotonicAt,
      );
      const session = await requireSession(organizationId, deps);
      const trace = createCeoTurnTrace(session, correlationId, startedMonotonicAt);
      trace.timeline.T1_backend_request_received = requestReceivedElapsedMs;
      const conversation = await session.conversations.get(
        organizationId,
        conversationId,
      );
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found." });
      }
      session.state.currentConversationId = conversation.id;
      traceStage(trace, "T3_conversation_session_resolution_complete");

      // Take over the raw response so we can stream SSE frames.
      reply.hijack();
      const raw = reply.raw;
      raw.setHeader("content-type", "text/event-stream; charset=utf-8");
      raw.setHeader("cache-control", "no-cache");
      raw.setHeader("connection", "keep-alive");
      raw.setHeader("x-departify-correlation-id", correlationId);
      raw.setHeader("x-accel-buffering", "no");
      raw.flushHeaders?.();

      const send = (event: string, data: unknown): void => {
        try {
          raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          /* client may have disconnected mid-write */
        }
      };
      const end = (): void => {
        try {
          raw.end();
        } catch {
          /* client may have disconnected */
        }
      };

      // Emit "received" the moment auth succeeds — the earliest honest
      // signal. Same event the JSON endpoint folds into the response, but
      // here it reaches the client immediately.
      send("activity", {
        kind: "work_state",
        state: "received",
        message: "Recibido. Empezamos.",
        at: Date.now(),
      });

      const captureActivity = (
        state:
          | "received"
          | "retrieving_context"
          | "delegated"
          | "working"
          | "analyzing"
          | "tool_started"
          | "tool_completed"
          | "preparing_result"
          | "streaming"
          | "completed"
          | "blocked"
          | "error",
        message: string,
        extra?: { departmentId?: string; capability?: string },
      ) => {
        send("activity", {
          kind: "work_state",
          state,
          message,
          ...(extra?.departmentId ? { departmentId: extra.departmentId } : {}),
          ...(extra?.capability ? { capability: extra.capability } : {}),
          at: Date.now(),
        });
      };

      try {
        captureActivity(
          "retrieving_context",
          activityMessageFor("retrieving_context"),
        );
        const runtime = await buildCeoRuntimeForRequest(
          session,
          deps,
          body.message,
          trace,
          request.authUser?.id,
        );
        if (runtime) {
          captureActivity(
            "delegated",
            activityMessageFor("delegated", {
              departmentId: "marketing",
            }),
            { departmentId: "marketing" },
          );
        }
        const result = await processCeoMessage(
          session,
          body.message,
          conversationId,
          deps.marketing,
          deps.engineRuntimePolicy,
          runtime,
          trace,
          deps,
          request.authUser?.id,
          // Sprint 65 P0 — the sink writes each event to the SSE stream
          // as it happens, so the CEO sees progress on every turn.
          captureActivity,
        );
        traceStage(trace, "T15_backend_response_finalization", {
          responseStatus: ceoTurnResponseStatus(trace),
          finalTextBytes: Buffer.byteLength(result.reply, "utf8"),
        });
        emitCeoTurnTrace(session, trace, result);
        const responseStatus = ceoTurnResponseStatus(trace);
        if (responseStatus >= 400) {
          const errorCode = trace.engineErrorCode ?? "ENGINE_EXECUTION";
          // Sprint 66 P0 — the CEO-facing message stays generic for the
          // product surface, but the responsible engineer must be able to
          // find the proximate cause in the internal log. Surface the
          // engine status, error code, and timeline so the failure is
          // traceable instead of buried behind a catch-all phrase.
          request.log.error(
            {
              correlationId,
              organizationId,
              conversationId,
              engineErrorCode: errorCode,
              openclawStatus: trace.openclawStatus,
              sessionFound: trace.sessionFound,
              durationMs: Date.now() - trace.startedMonotonicAt,
              timeline: trace.timeline,
            },
            "conversation SSE engine failure before persistence",
          );
          send("error", {
            code: errorCode,
            message:
              "No he podido completar esa respuesta porque el motor de negocio ha fallado. Vuelve a intentarlo.",
            requestId: correlationId,
            statusCode: responseStatus,
          });
          end();
          return;
        }

        // Compaction after the engine result is streamed, identical to
        // the JSON endpoint. Compaction is best-effort; a failure must
        // never break the SSE response.
        try {
          traceStage(trace, "T14_secondary_compaction_started");
          const persistedConversationId = result.conversationId || conversationId;
          const allMessages = await session.conversations.listMessages(
            organizationId,
            persistedConversationId,
          );
          const totalChars = allMessages.reduce(
            (sum, m) => sum + m.content.length,
            0,
          );
          if (shouldCompact(totalChars)) {
            const { older } = splitForCompaction(allMessages);
            const persisted = await session.conversations.get(
              organizationId,
              persistedConversationId,
            );
            const priorIndex = persisted?.compactedUpToMessageId
              ? allMessages.findIndex(
                  (message) => message.id === persisted.compactedUpToMessageId,
                )
              : -1;
            const newOlder = older.filter(
              (message) =>
                allMessages.findIndex(
                  (candidate) => candidate.id === message.id,
                ) > priorIndex,
            );
            if (newOlder.length > 0) {
              const lastFolded = newOlder[newOlder.length - 1] as ConversationMessage;
              const delta = summarizeOldMessages(
                newOlder.map((m) => ({ role: m.role, content: m.content })),
              );
              const summary = [persisted?.summary, delta]
                .filter(Boolean)
                .join("\n\n");
              await session.conversations.saveCompaction(
                organizationId,
                persistedConversationId,
                summary,
                lastFolded.id,
                (persisted?.compactionMessageCount ?? 0) + newOlder.length,
              );
            }
          }
          traceStage(trace, "T14_secondary_compaction_completed");
        } catch {
          traceStage(trace, "T14_secondary_compaction_failed", {
            errorClass: "secondary_write",
          });
        }

        send("result", result);
        end();
      } catch (cause) {
        if (cause instanceof MaxActiveConversationsError) {
          send("error", {
            code: "MAX_ACTIVE_CONVERSATIONS",
            message: cause.message,
            activeCount: cause.activeCount,
            maxActive: MAX_ACTIVE_CONVERSATIONS,
            statusCode: 409,
          });
          end();
          return;
        }
        emitCeoTurnFailureTrace(trace, cause);
        send("error", {
          code: "INTERNAL",
          message:
            "No he podido completar esa respuesta. Vuelve a intentarlo.",
          requestId: correlationId,
          statusCode: 500,
        });
        end();
      }
    },
  );

  server.post(
    "/api/customer-zero/:organizationId/conversations/:conversationId/archive",
    {
      schema: {
        tags: ["command-center"],
        summary: "Archive a conversation (company state is never touched)",
        params: {
          type: "object",
          required: ["organizationId", "conversationId"],
          properties: {
            organizationId: { type: "string" },
            conversationId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["ok"],
            properties: { ok: { type: "boolean" } },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, conversationId } = request.params as {
        organizationId: string;
        conversationId: string;
      };
      const session = await requireSession(organizationId, deps);
      const canonical = await session.conversations.ensureCanonical(organizationId);
      if (canonical.id === conversationId) {
        return reply.code(409).send({
          error: "The canonical CEO conversation cannot be archived.",
        });
      }
      const ok = await session.conversations.archive(
        organizationId,
        conversationId,
      );
      if (!ok) {
        return reply.code(404).send({ error: "Conversation not found." });
      }
      if (session.state.currentConversationId === conversationId) {
        delete session.state.currentConversationId;
      }
      return reply.code(200).send({ ok: true });
    },
  );
}

// Re-export the compaction threshold so a future test or operator tool
// can read the same constant the route enforces.
export const __COMPACTION_THRESHOLD_CHARS__ = COMPACTION_THRESHOLD_CHARS;

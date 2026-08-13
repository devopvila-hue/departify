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
  processCeoMessage,
  requireSession,
  MaxActiveConversationsError,
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
      const conversations = await session.conversations.listForOrg(organizationId);
      const activeCount = await session.conversations.countActiveForOrg(
        organizationId,
      );
      return reply.code(200).send({
        organizationId,
        conversations,
        activeCount,
        maxActive: MAX_ACTIVE_CONVERSATIONS,
      });
    },
  );

  server.get(
    "/api/customer-zero/:organizationId/conversations/history",
    {
      schema: {
        tags: ["command-center"],
        summary:
          "List all conversations (including archived). Archived conversations stay recoverable and never count toward the 5-active cap.",
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
        summary: "Create a new conversation for the organization",
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

      // P-B part 26 — 5-active-cap with archive-first UX. The 6th
      // conversation is REFUSED, not silently deleted. The portal asks
      // the CEO to archive one first.
      const activeCount = await session.conversations.countActiveForOrg(
        organizationId,
      );
      if (activeCount >= MAX_ACTIVE_CONVERSATIONS) {
        return reply.code(409).send({
          error: {
            code: "MAX_ACTIVE_CONVERSATIONS",
            message:
              "Ya tienes 5 conversaciones activas. Archiva una para empezar otra.",
            activeCount,
            maxActive: MAX_ACTIVE_CONVERSATIONS,
          },
        });
      }

      const conversation = await session.conversations.create(
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
      const messages = await session.conversations.listMessages(
        organizationId,
        conversationId,
      );
      session.state.currentConversationId = conversation.id;
      return reply.code(200).send({ conversation, messages });
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
      const session = await requireSession(organizationId, deps);
      const conversation = await session.conversations.get(
        organizationId,
        conversationId,
      );
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found." });
      }
      session.state.currentConversationId = conversation.id;
      const trace = createCeoTurnTrace(session, request.id);
      let result;
      try {
        const runtime = await buildCeoRuntimeForRequest(session, deps, message, trace);
        result = await processCeoMessage(
          session,
          message,
          conversationId,
          deps.marketing,
          deps.engineRuntimePolicy,
          runtime,
          trace,
        );
        emitCeoTurnTrace(session, runtime?.trace ?? trace, result);
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
        throw cause;
      }

      // After the message + assistant reply have been persisted, run
      // compaction if the transcript exceeds the provider-independent
      // character threshold. Raw history is preserved; only the model
      // context is rewritten to `[summary, ...recent]`.
      try {
        const allMessages = await session.conversations.listMessages(
          organizationId,
          conversationId,
        );
        const totalChars = allMessages.reduce(
          (sum, m) => sum + m.content.length,
          0,
        );
        if (shouldCompact(totalChars)) {
          const { older } = splitForCompaction(allMessages);
          if (older.length > 0) {
            const lastFolded = older[older.length - 1] as ConversationMessage;
            const summary = summarizeOldMessages(
              older.map((m) => ({ role: m.role, content: m.content })),
            );
            await session.conversations.saveCompaction(
              organizationId,
              conversationId,
              summary,
              lastFolded.id,
              older.length,
            );
          }
        }
      } catch {
        // Compaction is best-effort: a failure must NEVER break a CEO
        // turn. The bounded window continues to operate without a
        // summary until the next attempt.
      }

      return reply.code(200).send(result);
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
        },
      },
    },
    async (request, reply) => {
      const { organizationId, conversationId } = request.params as {
        organizationId: string;
        conversationId: string;
      };
      const session = await requireSession(organizationId, deps);
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

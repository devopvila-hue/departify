/**
 * Conversation routes — Phase P-B part 15.
 *
 * Durable, organization-scoped CEO chat sessions. Access goes through the
 * same P0-A tenant boundary (membership is enforced by the auth hook), and
 * every conversation operation is constrained to the organization id.
 *
 *   GET  /:org/conversations                        → list active conversations
 *   POST /:org/conversations                        → create (title optional)
 *   GET  /:org/conversations/:conversationId        → record + messages
 *   POST /:org/conversations/:conversationId/messages → send a CEO message
 *   POST /:org/conversations/:conversationId/archive  → archive
 */

import type { FastifyInstance } from "fastify";
import { DEFAULT_CONVERSATION_TITLE } from "../../customer-zero/conversation-store.js";
import { processCeoMessage, requireSession } from "./customer-zero-v2.js";
import type { ServerDeps } from "../deps.js";

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
      const conversations = await session.conversations.listForOrg(organizationId);
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
        body: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          additionalProperties: false,
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
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const body = request.body as { title?: string } | undefined;
      const session = await requireSession(organizationId, deps);
      const conversation = await session.conversations.create(
        organizationId,
        body?.title?.trim() || DEFAULT_CONVERSATION_TITLE,
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
              conversationId: { type: "string" },
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
      const { message } = request.body as { message: string };
      const session = await requireSession(organizationId, deps);
      const conversation = await session.conversations.get(
        organizationId,
        conversationId,
      );
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found." });
      }
      const result = await processCeoMessage(session, message, conversationId);
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
      const ok = await session.conversations.archive(organizationId, conversationId);
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

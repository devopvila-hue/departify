/**
 * Sprint 67 P0.8 — Founder Run Routes
 *
 * Durable Founder Development runs. The HTTP request creates the run and
 * returns a runId immediately; OpenClaw executes in the background.
 * The portal polls status or streams events; reconnects recover state.
 *
 * Endpoints:
 *   POST /api/customer-zero/:organizationId/founder/runs
 *     → create run, return { runId, status: "queued" }
 *   GET  /api/customer-zero/:organizationId/founder/runs/:runId
 *     → current run state + persisted events
 *   GET  /api/customer-zero/:organizationId/founder/runs/active
 *     → active run for the session (if any)
 *   POST /api/customer-zero/:organizationId/founder/runs/:runId/cancel
 *     → cancel a queued/running run
 *   GET  /api/customer-zero/:organizationId/founder/runs/:runId/stream
 *     → SSE event stream (replays missed events on reconnect)
 */

import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../deps.js";
import {
  founderRunStore,
  type FounderRunEvent,
} from "../../customer-zero/founder-run-store.js";
import { getFounderRunExecutor } from "../../customer-zero/founder-run-executor.js";
import { checkFounderAuthorization } from "../../customer-zero/founder-build-mode.js";

function getExecutor(deps: ServerDeps) {
  if (!deps.engine) {
    throw new Error("Engine adapter not available for founder runs");
  }
  return getFounderRunExecutor(deps.engine);
}

export async function registerFounderRunRoutes(
  server: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  /**
   * Resolve the authenticated user from the auth boundary.
   * The auth plugin attaches `request.authUser` when identity is valid.
   */
  const resolveUserId = (
    request: unknown,
  ): { userId: string; userRole?: string } | null => {
    const authUser = (request as { authUser?: { id: string } }).authUser;
    if (!authUser?.id) return null;
    return { userId: authUser.id };
  };

  /**
   * Verify the user is a founder for this org.
   */
  const requireFounder = async (
    request: unknown,
    organizationId: string,
  ): Promise<{ userId: string } | null> => {
    const identity = resolveUserId(request);
    if (!identity) return null;

    let userRole: string | undefined;
    if (deps.organizations) {
      const memberships = await deps.organizations.listForUser(identity.userId);
      const membership = memberships.find(
        (m) => m.organizationId === organizationId,
      );
      userRole = membership?.role;
    }

    const auth = checkFounderAuthorization(
      identity.userId,
      organizationId,
      userRole,
    );
    return auth ? { userId: identity.userId } : null;
  };

  // ─── Create a founder run ─────────────────────────────────────────

  server.post(
    "/api/customer-zero/:organizationId/founder/runs",
    {
      schema: {
        tags: ["founder-runs"],
        summary: "Create a durable founder development run",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        body: {
          type: "object",
          required: ["message"],
          properties: { message: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        response: {
          200: {
            type: "object",
            required: ["runId", "status"],
            properties: {
              runId: { type: "string" },
              status: { type: "string" },
              organizationId: { type: "string" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const body = request.body as { message: string };

      const identity = await requireFounder(request, organizationId);
      if (!identity) {
        return reply.code(401).send({ error: "No autorizado" });
      }

      const runExecutor = getExecutor(deps);
      const runId = runExecutor.submit({
        organizationId,
        userId: identity.userId,
        message: body.message,
      });

      const run = founderRunStore.get(runId);
      return {
        runId,
        status: run?.status ?? "queued",
        organizationId,
      };
    },
  );

  // ─── Get a run's state + events ───────────────────────────────────

  server.get(
    "/api/customer-zero/:organizationId/founder/runs/:runId",
    {
      schema: {
        tags: ["founder-runs"],
        summary: "Get founder run state and persisted events",
        params: {
          type: "object",
          required: ["organizationId", "runId"],
          properties: {
            organizationId: { type: "string" },
            runId: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: { afterSeq: { type: "integer" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              status: { type: "string" },
              input: { type: "string" },
              createdAt: { type: "integer" },
              startedAt: { type: ["integer", "null"] },
              completedAt: { type: ["integer", "null"] },
              toolCallCount: { type: "integer" },
              currentStep: { type: ["string", "null"] },
              finalText: { type: ["string", "null"] },
              errorCode: { type: ["string", "null"] },
              errorMessage: { type: ["string", "null"] },
              events: { type: "array" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, runId } = request.params as {
        organizationId: string;
        runId: string;
      };
      const identity = await requireFounder(request, organizationId);
      if (!identity) {
        return reply.code(401).send({ error: "No autorizado" });
      }

      const run = founderRunStore.get(runId);
      if (!run || run.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Run no encontrado" });
      }

      const query = request.query as { afterSeq?: number };
      const events = founderRunStore.getEvents(runId, query.afterSeq);

      return {
        id: run.id,
        status: run.status,
        input: run.input,
        createdAt: run.createdAt,
        startedAt: run.startedAt ?? null,
        completedAt: run.completedAt ?? null,
        toolCallCount: run.toolCallCount,
        currentStep: run.currentStep ?? null,
        finalText: run.finalText ?? null,
        errorCode: run.errorCode ?? null,
        errorMessage: run.errorMessage ?? null,
        events,
      };
    },
  );

  // ─── Get active run for the session ───────────────────────────────

  server.get(
    "/api/customer-zero/:organizationId/founder/runs/active",
    {
      schema: {
        tags: ["founder-runs"],
        summary: "Get the active run for the current founder session",
        params: {
          type: "object",
          required: ["organizationId"],
          properties: { organizationId: { type: "string" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              run: {
                type: ["object", "null"],
                properties: {
                  id: { type: "string" },
                  status: { type: "string" },
                  input: { type: "string" },
                  createdAt: { type: "integer" },
                  startedAt: { type: ["integer", "null"] },
                  completedAt: { type: ["integer", "null"] },
                  toolCallCount: { type: "integer" },
                  currentStep: { type: ["string", "null"] },
                  finalText: { type: ["string", "null"] },
                  errorCode: { type: ["string", "null"] },
                  errorMessage: { type: ["string", "null"] },
                },
              },
              events: { type: "array" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId } = request.params as { organizationId: string };
      const identity = await requireFounder(request, organizationId);
      if (!identity) {
        return reply.code(401).send({ error: "No autorizado" });
      }

      const sessionKey = `founder-development:${organizationId}:${identity.userId}`;
      const run = founderRunStore.getActiveRun(sessionKey);
      if (!run) {
        return { run: null, events: [] };
      }

      const events = founderRunStore.getEvents(run.id);
      return {
        run: {
          id: run.id,
          status: run.status,
          input: run.input,
          createdAt: run.createdAt,
          startedAt: run.startedAt ?? null,
          completedAt: run.completedAt ?? null,
          toolCallCount: run.toolCallCount,
          currentStep: run.currentStep ?? null,
          finalText: run.finalText ?? null,
          errorCode: run.errorCode ?? null,
          errorMessage: run.errorMessage ?? null,
        },
        events,
      };
    },
  );

  // ─── Cancel a run ─────────────────────────────────────────────────

  server.post(
    "/api/customer-zero/:organizationId/founder/runs/:runId/cancel",
    {
      schema: {
        tags: ["founder-runs"],
        summary: "Cancel a queued or running founder run",
        params: {
          type: "object",
          required: ["organizationId", "runId"],
          properties: {
            organizationId: { type: "string" },
            runId: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              cancelled: { type: "boolean" },
              runId: { type: "string" },
            },
          },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, runId } = request.params as {
        organizationId: string;
        runId: string;
      };
      const identity = await requireFounder(request, organizationId);
      if (!identity) {
        return reply.code(401).send({ error: "No autorizado" });
      }

      const run = founderRunStore.get(runId);
      if (!run || run.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Run no encontrado" });
      }

      const cancelled = getExecutor(deps).cancelRun(runId);
      return { cancelled, runId };
    },
  );

  // ─── Stream run events (SSE) ──────────────────────────────────────

  server.get(
    "/api/customer-zero/:organizationId/founder/runs/:runId/stream",
    {
      schema: {
        tags: ["founder-runs"],
        summary: "Stream founder run events (SSE)",
        params: {
          type: "object",
          required: ["organizationId", "runId"],
          properties: {
            organizationId: { type: "string" },
            runId: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: { afterSeq: { type: "integer" } },
        },
        response: {
          200: { type: "string" },
          401: { type: "object", properties: { error: { type: "string" } } },
          403: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { organizationId, runId } = request.params as {
        organizationId: string;
        runId: string;
      };
      const identity = await requireFounder(request, organizationId);
      if (!identity) {
        return reply.code(401).send({ error: "No autorizado" });
      }

      const run = founderRunStore.get(runId);
      if (!run || run.organizationId !== organizationId) {
        return reply.code(404).send({ error: "Run no encontrado" });
      }

      // Take over raw response for SSE
      reply.hijack();
      const raw = reply.raw;
      raw.setHeader("content-type", "text/event-stream; charset=utf-8");
      raw.setHeader("cache-control", "no-cache");
      raw.setHeader("connection", "keep-alive");
      raw.setHeader("x-accel-buffering", "no");
      raw.flushHeaders?.();

      const send = (event: string, data: unknown): void => {
        try {
          raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          /* client may have disconnected */
        }
      };
      const end = (): void => {
        try {
          raw.end();
        } catch {
          /* client disconnected */
        }
      };

      // Replay missed events from query param
      const query = request.query as { afterSeq?: number };
      const replay = founderRunStore.getEvents(runId, query.afterSeq);
      for (const event of replay) {
        send("event", event);
      }

      // If run already terminal, send result and close.
      if (run.status === "completed") {
        send("result", { runId: run.id, status: "completed", finalText: run.finalText });
        end();
        return;
      }
      if (run.status === "failed") {
        send("error", {
          runId: run.id,
          status: "failed",
          errorCode: run.errorCode,
          errorMessage: run.errorMessage,
        });
        end();
        return;
      }
      if (run.status === "cancelled") {
        send("error", {
          runId: run.id,
          status: "cancelled",
          errorMessage: run.errorMessage,
        });
        end();
        return;
      }

      // Subscribe to live events
      let closed = false;
      const onEvent = (eventRunId: string, event: FounderRunEvent): void => {
        if (closed || eventRunId !== runId) return;
        send("event", event);
        if (event.eventType === "run.completed") {
          send("result", {
            runId: run.id,
            status: "completed",
            finalText: run.finalText,
          });
        }
      };
      founderRunStore.on("run:event", onEvent);

      const onClose = (): void => {
        closed = true;
        founderRunStore.off("run:event", onEvent);
      };
      raw.on("close", onClose);
      raw.on("error", onClose);

      // Heartbeat to keep the connection alive
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          return;
        }
        try {
          raw.write(`: keep-alive\n\n`);
        } catch {
          onClose();
        }
      }, 15_000);
      heartbeat.unref();
    },
  );
}

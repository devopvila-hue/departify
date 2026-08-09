import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../deps.js";

/**
 * TEMPORARY internal engine diagnostics (Sprint ENGINE 02).
 *
 * Not a public API. Used only to verify the engine boundary from the backend
 * during this sprint. Remove once the EngineAdapter is consumed by real
 * product routes.
 */
export async function registerInternalEngineRoutes(
  server: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  if (!deps.engine) return;

  server.get("/internal/engine/health", async () => {
    const health = await deps.engine!.health();
    return { engine: "openclaw", ...health };
  });

  server.post<{ Body: { sessionId?: string; message: string } }>(
    "/internal/engine/send",
    async (request, reply) => {
      const { sessionId, message } = request.body ?? {};
      if (!message || typeof message !== "string") {
        return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "message required" } });
      }
      const engine = deps.engine!;
      const session = await engine.createSession(
        sessionId ? { sessionId } : {},
      );
      const result = await engine.sendMessage({
        sessionId: session.id,
        message,
      });
      return {
        sessionId: session.id,
        text: result.text,
        status: result.status,
        usage: result.usage,
        toolCalls: result.toolCalls,
        durationMs: result.durationMs,
      };
    },
  );

  server.get<{ Querystring: { sessionId?: string } }>(
    "/internal/engine/session",
    async (request) => {
      const { sessionId } = request.query;
      if (!sessionId) {
        return { session: null };
      }
      const engine = deps.engine!;
      const session = await engine.getSession(sessionId);
      return { session };
    },
  );
}

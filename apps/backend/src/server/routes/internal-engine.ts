import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../deps.js";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_AUDIENCE,
  issueScopedRuntimeToken,
  organizationFromOpenClawSessionKey,
  runtimeTokenSecret,
  validateScopedRuntimeToken,
} from "../../customer-zero/runtime-identity.js";
import { resolveCompanyDnaStore } from "../../customer-zero/company-readiness.js";
import {
  buildCanonicalConnectionViews,
  buildMarketingOperationalActivity,
  requireSession,
  workStoreForRoutes,
} from "./customer-zero-v2.js";
import { compileRuntimeBusinessContext } from "../../customer-zero/department-context-compiler.js";
import { buildRuntimeCapabilityManifest } from "../../customer-zero/capability-manifest.js";

const NATIVE_TOOL_NAME = "departify.company.context";

function safeTraceHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function configuredNativeTools(deps: ServerDeps): boolean {
  return deps.nativeBusinessTools === true;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function runtimeTokenAuth(request: { headers: { authorization?: unknown } }): string | null {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  return value.slice("Bearer ".length).trim();
}

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

  server.post<{ Body: { sessionKey?: string } }>(
    "/internal/native-tools/runtime-token",
    async (request, reply) => {
      if (!configuredNativeTools(deps)) return reply.code(404).send({ error: "not_found" });
      const secret = runtimeTokenSecret();
      if (!secret || !sameSecret(runtimeTokenAuth(request) ?? "", secret)) {
        return reply.code(401).send({ error: "invalid_runtime_identity" });
      }
      const sessionKey = request.body?.sessionKey?.trim() ?? "";
      const identity = organizationFromOpenClawSessionKey(sessionKey);
      if (!identity) return reply.code(403).send({ error: "invalid_session_scope" });
      const issued = issueScopedRuntimeToken({
        secret,
        organizationId: identity.organizationId,
        sessionKey,
        agentId: identity.agentId,
      });
      console.info("[native-tool-trace]", {
        nativeTool: true,
        toolName: NATIVE_TOOL_NAME,
        organizationHash: safeTraceHash(issued.claims.organizationId),
        authorized: true,
        status: "runtime_token_issued",
      });
      return { token: issued.token, audience: DEFAULT_AUDIENCE, expiresAt: issued.claims.exp };
    },
  );

  server.post<{ Body: { section?: string } }>(
    "/internal/native-tools/company-context",
    async (request, reply) => {
      const startedAt = Date.now();
      if (!configuredNativeTools(deps)) return reply.code(404).send({ error: "not_found" });
      const secret = runtimeTokenSecret();
      const token = secret ? runtimeTokenAuth(request) : null;
      const validation = token && secret
        ? validateScopedRuntimeToken({ token, secret, expectedAudience: DEFAULT_AUDIENCE })
        : { valid: false, reason: "runtime_identity_unconfigured" };
      if (!validation.valid || !validation.claims) {
        console.info("[native-tool-trace]", {
          nativeTool: true,
          toolName: NATIVE_TOOL_NAME,
          authorized: false,
          status: validation.reason ?? "unauthorized",
          durationMs: Date.now() - startedAt,
        });
        return reply.code(401).send({ error: "invalid_runtime_identity" });
      }
      const identity = organizationFromOpenClawSessionKey(validation.claims.sessionKey);
      if (!identity || identity.organizationId !== validation.claims.organizationId) {
        return reply.code(403).send({ error: "invalid_session_scope" });
      }
      const session = await requireSession(identity.organizationId, deps);
      const [companyDna, connections, tasks, results] = await Promise.all([
        resolveCompanyDnaStore(deps).get(identity.organizationId),
        buildCanonicalConnectionViews(session, session.state.locale),
        workStoreForRoutes().listTasksForOrg(identity.organizationId, 50),
        workStoreForRoutes().listResultsForOrg(identity.organizationId, 20),
      ]);
      const runtimeConnections = connections.map((connection) => ({
        toolId: connection.toolId,
        label: connection.label,
        state: connection.state,
        ...(connection.capabilities ? { capabilities: connection.capabilities } : {}),
      }));
      const capabilities = buildRuntimeCapabilityManifest(runtimeConnections);
      const companyContextCapability = capabilities.capabilities.find(
        (capability) => capability.id === "company.context",
      );
      if (!companyContextCapability?.available) {
        console.info("[native-tool-trace]", {
          nativeTool: true,
          toolName: NATIVE_TOOL_NAME,
          organizationHash: safeTraceHash(validation.claims.organizationId),
          authorized: false,
          status: "capability_unavailable",
        });
        return reply.code(403).send({ error: "capability_unavailable" });
      }
      const context = compileRuntimeBusinessContext({
        session,
        companyDna,
        capabilities,
        connections: runtimeConnections,
        tasks,
        results,
        approvals: deps.marketing
          ? await deps.marketing.listApprovals(identity.organizationId)
          : [],
        activeObjective: deps.marketing
          ? (await deps.marketing.listObjectives(identity.organizationId)).find(
              (objective) => objective.status === "active",
            ) ?? null
          : null,
        recentActivity: buildMarketingOperationalActivity(tasks, results),
      });
      const section = request.body?.section;
      const result = {
        status: "success",
        organization: context.organization,
        identity: context.identity,
        company: context.company,
        activeObjective: context.activeObjective,
        departments: section === "objective" ? [] : context.departments,
        activeWork: section === "summary" ? [] : context.activeWork,
        capabilities: context.capabilities,
      };
      console.info("[native-tool-trace]", {
        nativeTool: true,
        toolName: NATIVE_TOOL_NAME,
        organizationHash: safeTraceHash(validation.claims.organizationId),
        authorized: true,
        status: "success",
        durationMs: Date.now() - startedAt,
        resultBytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
        engineSessionId: safeTraceHash(validation.claims.sessionKey),
      });
      return result;
    },
  );

  const requireInternalAuth = (request: { authUser?: unknown }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    // Local test/dev servers may intentionally omit AuthService. Production
    // always wires it, so diagnostics cannot become an unauthenticated model
    // execution endpoint in the deployed control plane.
    if (deps.auth && !request.authUser) {
      reply.code(401).send({ error: "authentication_required" });
      return false;
    }
    return true;
  };

  server.get("/internal/engine/health", async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return;
    const health = await deps.engine!.health();
    return { engine: "openclaw", ...health };
  });

  server.post<{ Body: { sessionId?: string; message: string } }>(
    "/internal/engine/send",
    async (request, reply) => {
      if (!requireInternalAuth(request, reply)) return;
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
    async (request, reply) => {
      if (!requireInternalAuth(request, reply)) return;
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

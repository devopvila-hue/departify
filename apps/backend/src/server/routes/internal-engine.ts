import type { FastifyInstance } from "fastify";
import type { BackendConfig } from "@departify/config";
import type { ServerDeps } from "../deps.js";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  DEFAULT_AUDIENCE,
  issueScopedRuntimeToken,
  isPersistedOrganizationId,
  organizationFromOpenClawSessionKey,
  runtimeTokenSecret,
  validateScopedRuntimeToken,
} from "../../customer-zero/runtime-identity.js";
import { resolveCompanyDnaStore } from "../../customer-zero/company-readiness.js";
import {
  buildCanonicalConnectionViews,
  buildMarketingOperationalActivity,
  readEmailAnswer,
  runCalendarReadTurn,
  requireSession,
  workStoreForRoutes,
} from "./customer-zero-v2.js";
import { compileRuntimeBusinessContext } from "../../customer-zero/department-context-compiler.js";
import { buildRuntimeCapabilityManifest } from "../../customer-zero/capability-manifest.js";
import { GoogleDriveAdapter } from "../../customer-zero/google-drive-adapter.js";
import { findOperationalGoogleIdentityForOrg } from "../../customer-zero/credential-resolver.js";
import { completeExecutionReceipt, failExecutionReceipt, startExecutionReceipt } from "../../customer-zero/execution-receipt.js";
import {
  getGoogleTokenStore,
  hasOperationalGoogleCapability,
} from "../../customer-zero/google-tokens.js";
import {
  isNativeReadToolName,
  nativeToolsForManifest,
  requiredCapabilityForNativeTool,
  type NativeReadToolName,
} from "../../customer-zero/native-business-tools.js";

const NATIVE_TOOL_NAME = "departify.company.context";

function nativeRuntimeConnections(
  connections: ReadonlyArray<Awaited<ReturnType<typeof buildCanonicalConnectionViews>>[number]>,
  googleSummaries: Awaited<ReturnType<ReturnType<typeof getGoogleTokenStore>["listForOrg"]>>,
) {
  return connections.map((connection) => ({
    toolId: connection.toolId,
    label: connection.label,
    state: connection.state,
    ...(connection.toolId === "gmail"
      ? {
          capabilities: [
            ...(googleSummaries.some((summary) => hasOperationalGoogleCapability(summary, "email.read"))
              ? ["email.read", "email.search", "email.thread.read"]
              : []),
            ...(googleSummaries.some((summary) => hasOperationalGoogleCapability(summary, "email.send"))
              ? ["email.send.personal"]
              : []),
          ],
        }
      : connection.toolId === "google_calendar"
        ? {
            capabilities: [
              ...(googleSummaries.some((summary) => hasOperationalGoogleCapability(summary, "calendar.read")) ? ["calendar.read"] : []),
              ...(googleSummaries.some((summary) => hasOperationalGoogleCapability(summary, "calendar.create")) ? ["calendar.create"] : []),
            ],
          }
        : connection.toolId === "google_workspace" || connection.toolId === "google_drive"
          ? {
              capabilities: [
                ...(googleSummaries.some((summary) => hasOperationalGoogleCapability(summary, "drive.search")) ? ["drive.search"] : []),
                ...(googleSummaries.some((summary) => hasOperationalGoogleCapability(summary, "drive.read")) ? ["drive.read"] : []),
              ],
            }
          : connection.capabilities
            ? { capabilities: connection.capabilities }
            : {}),
  }));
}

function nativeArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nativeText(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === "string" ? args[key].trim() : "";
}

function runtimeProviderUnavailable(reply: string): boolean {
  return /(?:todavía no está|no está activado|no está disponible|no he podido consultar|not activated|not available)/i.test(reply);
}

function safeNativeCapabilities(manifest: ReturnType<typeof buildRuntimeCapabilityManifest>) {
  return {
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    capabilities: manifest.capabilities.map((capability) => ({
      id: capability.id,
      available: capability.available,
      ...(capability.reason ? { reason: capability.reason } : {}),
    })),
  };
}

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
 * Internal native tool gateway (ENGINE 03.2).
 *
 * Not a public API. Used only to verify the engine boundary from the backend
 * The runtime plugin is intentionally untrusted for authorization: every
 * invocation is revalidated here against the tenant session and live
 * capability projection.
 */
export async function registerInternalEngineRoutes(
  server: FastifyInstance,
  deps: ServerDeps,
  config?: Pick<BackendConfig, "environment">,
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
      if (!identity || (config?.environment === "production" && !isPersistedOrganizationId(identity.organizationId))) {
        return reply.code(403).send({ error: "invalid_session_scope" });
      }
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
      if (!identity || (config?.environment === "production" && !isPersistedOrganizationId(identity.organizationId)) || identity.organizationId !== validation.claims.organizationId) {
        return reply.code(403).send({ error: "invalid_session_scope" });
      }
      const session = await requireSession(identity.organizationId, deps);
      const [companyDna, connections, tasks, results, googleSummaries] = await Promise.all([
        resolveCompanyDnaStore(deps).get(identity.organizationId),
        buildCanonicalConnectionViews(session, session.state.locale),
        workStoreForRoutes().listTasksForOrg(identity.organizationId, 50),
        workStoreForRoutes().listResultsForOrg(identity.organizationId, 20),
        getGoogleTokenStore().listForOrg(identity.organizationId),
      ]);
      const runtimeConnections = nativeRuntimeConnections(connections, googleSummaries);
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
        capabilities: safeNativeCapabilities(context.capabilities),
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

  server.post<{ Body: { toolName?: string; params?: unknown } }>(
    "/internal/native-tools/tool",
    async (request, reply) => {
      const startedAt = Date.now();
      if (!configuredNativeTools(deps)) return reply.code(404).send({ error: "not_found" });
      const secret = runtimeTokenSecret();
      const token = secret ? runtimeTokenAuth(request) : null;
      const validation = token && secret
        ? validateScopedRuntimeToken({ token, secret, expectedAudience: DEFAULT_AUDIENCE })
        : { valid: false, reason: "runtime_identity_unconfigured" };
      const toolName = typeof request.body?.toolName === "string" ? request.body.toolName : "";
      if (!validation.valid || !validation.claims) {
        console.info("[native-tool-trace]", {
          nativeTool: true,
          toolName: isNativeReadToolName(toolName) ? toolName : "unknown",
          authorized: false,
          status: validation.reason ?? "unauthorized",
          durationMs: Date.now() - startedAt,
        });
        return reply.code(401).send({ error: "invalid_runtime_identity" });
      }
      const identity = organizationFromOpenClawSessionKey(validation.claims.sessionKey);
      if (!identity || (config?.environment === "production" && !isPersistedOrganizationId(identity.organizationId)) || identity.organizationId !== validation.claims.organizationId || validation.claims.agentId !== "main") {
        return reply.code(403).send({ error: "invalid_session_scope" });
      }
      if (!isNativeReadToolName(toolName)) {
        return reply.code(404).send({ error: "unknown_native_tool" });
      }
      const session = await requireSession(identity.organizationId, deps);
      const connections = await buildCanonicalConnectionViews(session, session.state.locale);
      const googleSummaries = await getGoogleTokenStore().listForOrg(identity.organizationId);
      const runtimeConnections = nativeRuntimeConnections(connections, googleSummaries);
      const capabilities = buildRuntimeCapabilityManifest(runtimeConnections);
      const availableTools = nativeToolsForManifest(capabilities);
      if (!availableTools.includes(toolName as NativeReadToolName)) {
        console.info("[native-tool-trace]", {
          nativeTool: true,
          toolName,
          organizationHash: safeTraceHash(identity.organizationId),
          authorized: false,
          status: "capability_unavailable",
          durationMs: Date.now() - startedAt,
        });
        return reply.code(403).send({ error: "capability_unavailable" });
      }
      const args = nativeArgs(request.body?.params);
      let result: Record<string, unknown>;
      const isEs = session.state.locale !== "en";
      if (toolName === "departify.company.context") {
        const [companyDna, tasks, results, approvals, objectives] = await Promise.all([
          resolveCompanyDnaStore(deps).get(identity.organizationId),
          workStoreForRoutes().listTasksForOrg(identity.organizationId, 50),
          workStoreForRoutes().listResultsForOrg(identity.organizationId, 20),
          deps.marketing?.listApprovals(identity.organizationId) ?? Promise.resolve([]),
          deps.marketing?.listObjectives(identity.organizationId) ?? Promise.resolve([]),
        ]);
        const context = compileRuntimeBusinessContext({
          session,
          companyDna,
          capabilities,
          connections: runtimeConnections,
          tasks,
          results,
          approvals,
          activeObjective: objectives.find((objective) => objective.status === "active") ?? null,
          recentActivity: buildMarketingOperationalActivity(tasks, results),
        });
        const section = nativeText(args, "section");
        result = {
          status: "success",
          operation: toolName,
          organization: context.organization,
          identity: context.identity,
          company: context.company,
          activeObjective: context.activeObjective,
          departments: section === "objective" ? [] : context.departments,
          activeWork: section === "summary" ? [] : context.activeWork,
          capabilities: safeNativeCapabilities(context.capabilities),
        };
      } else if (toolName === "departify.email.list" || toolName === "departify.email.search") {
        const query = toolName === "departify.email.search" ? nativeText(args, "query") : "mis últimos correos";
        const summary = await readEmailAnswer(
          identity.organizationId,
          toolName === "departify.email.search" ? `busca en el correo de empresa ${query}` : query,
          session.state.locale,
          session,
        );
        const blocked = !summary || runtimeProviderUnavailable(summary);
        result = { status: blocked ? "blocked" : "success", operation: toolName, summary: summary ?? "No hay resultados disponibles." };
      } else if (toolName === "departify.calendar.list") {
        const outcome = await runCalendarReadTurn(session, nativeText(args, "range") || "mis próximos eventos", isEs);
        result = { status: runtimeProviderUnavailable(outcome.reply) ? "blocked" : "success", operation: toolName, summary: outcome.reply };
      } else if (toolName === "departify.drive.search" || toolName === "departify.drive.read") {
        const driveCapability = toolName === "departify.drive.read" ? "drive.read" : "drive.search";
        const identityForDrive = await findOperationalGoogleIdentityForOrg(identity.organizationId, driveCapability);
        if (!identityForDrive) {
          result = { status: "blocked", operation: toolName, summary: "Drive todavía no está activado." };
        } else {
          const adapter = new GoogleDriveAdapter({ organizationId: identity.organizationId, userId: identityForDrive.userId });
          const receipt = startExecutionReceipt({
            operationId: `native_${toolName.replaceAll(".", "_")}_${Date.now().toString(36)}`,
            intent: toolName,
            capability: requiredCapabilityForNativeTool(toolName as NativeReadToolName) ?? "drive.search",
            provider: "google",
            sideEffect: false,
          });
          session.state.lastExecutionReceipt = receipt;
          if (toolName === "departify.drive.read") {
            const driveResult = await adapter.readFile({ fileId: nativeText(args, "fileId") });
            if (!driveResult.success) {
              session.state.lastExecutionReceipt = failExecutionReceipt(receipt, driveResult.errorCode ?? "provider_error");
              result = { status: "blocked", operation: toolName, summary: driveResult.message ?? "Drive no está disponible." };
            } else {
              const file = driveResult.value;
              session.state.lastExecutionReceipt = completeExecutionReceipt(receipt, {
                ...(file?.id ? { providerResourceId: file.id } : {}),
                safeMetadata: {
                  ...(file?.mimeType ? { mimeType: file.mimeType } : {}),
                  ...(file?.name ? { name: file.name } : {}),
                },
              });
              result = { status: "success", operation: toolName, data: file ? { id: file.id, name: file.name, mimeType: file.mimeType, preview: file.preview?.slice(0, 4000) ?? "" } : {} };
            }
          } else {
            const includeFolders = args.includeFolders === true;
            const driveResult = includeFolders
              ? await adapter.listFiles({
                  mimeType: "application/vnd.google-apps.folder",
                  ...(nativeText(args, "parentId") ? { parentId: nativeText(args, "parentId") } : {}),
                  pageSize: Number(args.limit ?? 20),
                })
              : await adapter.searchFiles({
                  ...(nativeText(args, "query") ? { query: nativeText(args, "query") } : {}),
                  ...(nativeText(args, "parentId") ? { parentId: nativeText(args, "parentId") } : {}),
                  ...(nativeText(args, "mimeType") ? { mimeType: nativeText(args, "mimeType") } : {}),
                  pageSize: Number(args.limit ?? 20),
                });
            if (!driveResult.success) {
              session.state.lastExecutionReceipt = failExecutionReceipt(receipt, driveResult.errorCode ?? "provider_error");
              result = { status: "blocked", operation: toolName, summary: driveResult.message ?? "Drive no está disponible." };
            } else {
              const files = driveResult.value ?? [];
              session.state.lastExecutionReceipt = completeExecutionReceipt(receipt, { safeMetadata: { resultCount: files.length } });
              result = { status: "success", operation: toolName, data: { files: files.slice(0, 50).map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, modifiedTime: file.modifiedTime, webViewLink: file.webViewLink })) } };
            }
          }
        }
      } else if (toolName === "departify.tasks.list") {
        const tasks = await workStoreForRoutes().listTasksForOrg(identity.organizationId, Number(args.limit ?? 20));
        result = { status: "success", operation: toolName, data: { tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, departmentId: task.departmentId })) } };
      } else if (toolName === "departify.approvals.list") {
        const approvals = await deps.marketing?.listApprovals(identity.organizationId) ?? [];
        result = { status: "success", operation: toolName, data: { approvals: approvals.slice(0, Number(args.limit ?? 20)).map((approval) => ({ id: approval.id, title: approval.title, status: approval.status })) } };
      } else {
        const results = await workStoreForRoutes().listResultsForOrg(identity.organizationId, Number(args.limit ?? 20));
        result = { status: "success", operation: toolName, data: { results: results.map((entry) => ({ id: entry.id, title: entry.title, summary: entry.summary })) } };
      }
      console.info("[native-tool-trace]", {
        nativeTool: true,
        toolName,
        organizationHash: safeTraceHash(identity.organizationId),
        engineSessionId: safeTraceHash(validation.claims.sessionKey),
        authorized: true,
        status: result.status,
        durationMs: Date.now() - startedAt,
        resultBytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
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

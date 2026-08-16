import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  selectConnectorRuntime,
  type ConnectorExecutionRequest,
  type ConnectorOperation,
  type ConnectorRuntime,
} from "@departify/connector-runtime";
import type { ServerDeps } from "../deps.js";
import {
  credentialRequiredResult,
  getConnectorCapability,
  } from "../../customer-zero/activepieces-connector.js";
import {
  credentialRequiredAdsResult,
  getAdsCapability,
  providerForAdsCapability,
  type AdsCapabilityDefinition,
} from "../../customer-zero/ads-capabilities.js";
import {
  getMarketingConnectorCapability,
} from "../../customer-zero/marketing-connector.js";
import type { DepartmentWorkCapability } from "../../customer-zero/department-work.js";

interface ConnectorParams {
  organizationId: string;
}

interface ConnectorBody {
  operation?: ConnectorOperation;
  capability?: string;
  input?: Record<string, unknown>;
}

function safeInput(input: Record<string, unknown>): string | null {
  const forbidden = [
    "organizationId",
    "tenantId",
    "provider",
    "providerAccountId",
    "accountId",
    "customerId",
    "credentialReference",
    "accessToken",
    "refreshToken",
    "developerToken",
  ];
  const key = Object.keys(input).find((candidate) => forbidden.includes(candidate));
  return key ?? null;
}

function runtimeForCapability(
  deps: ServerDeps,
  capability: AdsCapabilityDefinition,
): ConnectorRuntime | undefined {
  const selected = selectConnectorRuntime(
    capability.id,
    deps.connectorRuntimes ?? [],
  );
  if (selected) return selected.candidate.runtime;
  // The legacy Activepieces path is a deliberately narrow compatibility
  // path for the original Meta read/manage slice. It must never become a
  // silent write fallback for Google Ads or an unconfigured TikTok capability.
  if (capability.platform === "meta" && ["marketing.meta.ads.read", "marketing.meta.ads.manage"].includes(capability.id)) {
    return deps.connectorRuntime;
  }
  return undefined;
}

function providerToolIds(capability: AdsCapabilityDefinition): readonly string[] {
  return capability.providerToolId === "meta_ads"
    ? ["meta_ads", "meta_business"]
    : [capability.providerToolId];
}

/**
 * Authenticated Departify → ConnectorRuntime boundary.
 *
 * The organization id comes only from the authenticated route context. The
 * request body cannot select a different tenant, provider, or credential.
 */
export async function registerConnectorRuntimeRoutes(
  server: FastifyInstance,
  deps: ServerDeps,
): Promise<void> {
  server.get<{ Params: ConnectorParams }>(
    "/api/customer-zero/:organizationId/connector-runtime/health",
    async (request, reply) => {
      const organizationId = request.params.organizationId;
      const authOrganizationId = request.authContext?.organizationId;
      if (!authOrganizationId || authOrganizationId !== organizationId) {
        return reply.code(403).send({ error: "tenant_mismatch" });
      }
      const healthRuntime = deps.connectorRuntime ?? deps.connectorRuntimes?.[0]?.runtime;
      if (!healthRuntime) {
        return reply.code(503).send({
          healthy: false,
          status: 0,
          error: "This advertising connection is not configured.",
        });
      }
      const health = await healthRuntime.health();
      request.log.info({
        event: "connector_runtime_health",
        provider: health.provider,
        healthy: health.healthy,
        status: health.status,
        organizationId,
        durationMs: health.durationMs,
      });
      const clientHealth = publicConnectorResult(health);
      return reply.code(health.healthy ? 200 : 502).send(clientHealth);
    },
  );

  server.post<{ Params: ConnectorParams; Body: ConnectorBody }>(
    "/api/customer-zero/:organizationId/connector-runtime/execute",
    async (request, reply) => {
      const organizationId = request.params.organizationId;
      const authOrganizationId = request.authContext?.organizationId;
      if (!authOrganizationId || authOrganizationId !== organizationId) {
        return reply.code(403).send({ error: "tenant_mismatch" });
      }

      const capability = getAdsCapability(request.body.capability ?? "");
      const connectorCapability = capability
        ? null
        : getConnectorCapability(request.body.capability ?? "");
      const marketingCapability = capability || connectorCapability
        ? null
        : getMarketingConnectorCapability(request.body.capability ?? "");
      const legacyCapability = capability ? null : request.body.capability === "marketing.meta.ads.read" || request.body.capability === "marketing.meta.ads.manage"
        ? request.body.capability
        : null;
      if (!capability && !connectorCapability && !marketingCapability && !legacyCapability) {
        return reply.code(404).send({ error: "capability_not_registered" });
      }
      const operation = request.body.operation ?? "prepare";
      const input = request.body.input ?? {};
      const forbiddenInputKey = safeInput(input);
      if (forbiddenInputKey) {
        return reply.code(403).send({ error: { code: forbiddenInputKey === "organizationId" || forbiddenInputKey === "tenantId" ? "tenant_mismatch" : "credential_or_account_override" } });
      }
      if (marketingCapability) {
        const executionRequest: ConnectorExecutionRequest = {
          requestId: request.id,
          organizationId,
          ...(request.authUser?.id ? { userId: request.authUser.id } : {}),
          capability: marketingCapability.id,
          operation,
          input,
          sideEffect: marketingCapability.sideEffect,
        };
        const runtime = deps.marketingConnectorRuntime;
        if (!runtime) return reply.code(503).send({ status: "not_configured", error: { code: "provider_unavailable", message: "This marketing connection is not configured.", retryable: false } });
        if (operation === "execute") {
          if (marketingCapability.sideEffect) {
            const approvalId = typeof input.approvalId === "string" ? input.approvalId : "";
            const approvals = deps.marketing ? await deps.marketing.listApprovals(organizationId) : [];
            const approved = approvals.find((approval) => approval.id === approvalId && approval.status === "approved" && approval.title === marketingConnectorTaskTitle(marketingCapability.id));
            if (!approved) {
              const prepared = await runtime.execute({ ...executionRequest, operation: "prepare" });
              const durable = await persistMarketingConnectorOutcome(deps, { ...executionRequest, operation: "prepare" }, marketingCapability, prepared);
              const requestedApproval = deps.marketing
                ? await deps.marketing.requestApproval({
                    organizationId,
                    title: marketingConnectorTaskTitle(marketingCapability.id),
                    detail: "Elvira ha preparado esta operación. Revisa el contenido y aprueba explícitamente antes de ejecutarla.",
                    locale: "es",
                  })
                : null;
              return reply.code(409).send({
                requestId: request.id,
                organizationId,
                capability: marketingCapability.id,
                operation,
                status: "prepared",
                ...(requestedApproval ? { approvalId: requestedApproval.id } : {}),
                ...(durable?.taskId ? { taskId: durable.taskId } : {}),
                ...(durable?.resultId ? { resultId: durable.resultId } : {}),
                error: { code: "approval_required", message: "This change needs CEO approval before it can run.", retryable: false },
              });
            }
          }
          const state = await deps.toolState?.get(organizationId, marketingCapability.providerToolId);
          if (state?.status !== "connected" || !state.verifiedAt || !state.grantedCapabilities?.includes(marketingCapability.id)) {
            return reply.code(424).send({
              requestId: request.id,
              organizationId,
              capability: marketingCapability.id,
              operation,
              status: "credential_required",
              error: { code: "credential_required", message: "Connect and verify this marketing tool before using it.", retryable: false },
            });
          }
        }
        const result = await runtime.execute(executionRequest);
        const durable = await persistMarketingConnectorOutcome(deps, executionRequest, marketingCapability, result);
        return reply.code(result.status === "succeeded" || result.status === "prepared" ? 200 : 502).send({
          ...publicConnectorResult(result),
          ...(durable?.taskId ? { taskId: durable.taskId } : {}),
          ...(durable?.resultId ? { resultId: durable.resultId } : {}),
        });
      }
      if (!capability) {
        if (connectorCapability) {
          const executionRequest: ConnectorExecutionRequest = {
            requestId: request.id,
            organizationId,
            ...(request.authUser?.id ? { userId: request.authUser.id } : {}),
            capability: connectorCapability.id,
            operation,
            input,
            sideEffect: connectorCapability.sideEffect,
          };
          if (operation === "execute") {
            if (connectorCapability.sideEffect) {
              const approvalId = typeof input.approvalId === "string" ? input.approvalId : "";
              const approvals = deps.marketing ? await deps.marketing.listApprovals(organizationId) : [];
              const approved = approvals.find((approval) => approval.id === approvalId && approval.status === "approved");
              if (!approved) {
                return reply.code(409).send({
                  requestId: request.id,
                  organizationId,
                  capability: connectorCapability.id,
                  operation,
                  status: "prepared",
                  error: { code: "approval_required", message: "This social publication needs CEO approval before it can run.", retryable: false },
                });
              }
            }
            const state = await deps.toolState?.get(organizationId, connectorCapability.providerToolId);
            if (state?.status !== "connected" || !state.verifiedAt || !state.grantedCapabilities?.includes(connectorCapability.id)) {
              return reply.code(424).send({
                requestId: request.id,
                organizationId,
                capability: connectorCapability.id,
                operation,
                status: "credential_required",
                error: { code: "credential_required", message: "Facebook Pages must be verified with the requested capability before publishing.", retryable: false },
              });
            }
          }
          const runtime = selectConnectorRuntime(connectorCapability.id, deps.connectorRuntimes ?? [])?.candidate.runtime ?? deps.connectorRuntime;
          if (!runtime) {
            return reply.code(503).send({
              requestId: request.id,
              organizationId,
              capability: connectorCapability.id,
              operation,
              status: "not_configured",
              error: { code: "provider_unavailable", message: "Facebook Pages publishing is not configured.", retryable: false },
            });
          }
          const result = await runtime.execute(executionRequest);
          return reply.code(result.status === "succeeded" || result.status === "prepared" ? 200 : 502).send(publicConnectorResult(result));
        }
        const legacy = {
          id: legacyCapability!,
          providerToolId: "meta_business" as const,
          sideEffect: legacyCapability === "marketing.meta.ads.manage",
          requiresOAuth: true as const,
        };
        const executionRequest: ConnectorExecutionRequest = { requestId: request.id, organizationId, ...(request.authUser?.id ? { userId: request.authUser.id } : {}), capability: legacy.id, operation, input, sideEffect: legacy.sideEffect };
        if (operation === "execute") {
          const state = await deps.toolState?.get(organizationId, legacy.providerToolId);
          if (state?.status !== "connected") return reply.code(424).send(publicConnectorResult(credentialRequiredResult(request.id, organizationId, legacy, operation)));
        }
        if (!deps.connectorRuntime) return reply.code(503).send({ status: "not_configured", error: { code: "provider_unavailable", message: "This advertising connection is not configured.", retryable: false } });
        const result = await deps.connectorRuntime.execute(executionRequest);
        return reply.code(result.status === "succeeded" || result.status === "prepared" ? 200 : 502).send(publicConnectorResult(result));
      }
      const executionRequest: ConnectorExecutionRequest = {
        requestId: request.id,
        organizationId,
        ...(request.authUser?.id ? { userId: request.authUser.id } : {}),
        capability: capability.id,
        operation,
        input,
        sideEffect: capability.sideEffect,
      };

      if (operation === "execute") {
        if (capability.sideEffect) {
          const approvalId = typeof input.approvalId === "string" ? input.approvalId : "";
          const approvals = deps.marketing ? await deps.marketing.listApprovals(organizationId) : [];
          const approved = approvals.find((approval) => approval.id === approvalId && approval.status === "approved");
          if (!approved) {
            return reply.code(409).send({
              requestId: request.id,
              organizationId,
              capability: capability.id,
              operation,
              status: "prepared",
              error: { code: "approval_required", message: "This advertising change needs CEO approval before it can run.", retryable: false },
            });
          }
        }
        const state = await firstToolState(deps, organizationId, providerToolIds(capability));
        if (state?.status !== "connected") {
          const result = credentialRequiredAdsResult(request.id, organizationId, capability, operation, providerForAdsCapability(capability, operation));
          return reply.code(424).send(publicConnectorResult(result));
        }
      }
      const runtime = runtimeForCapability(deps, capability);
      if (!runtime) {
        return reply.code(503).send({
          requestId: request.id,
          organizationId,
          capability: capability.id,
          operation,
          status: "not_configured",
          error: {
            code: "provider_unavailable",
            message: "This advertising connection is not configured.",
            retryable: false,
          },
        });
      }

      const result = await runtime.execute(executionRequest);
      request.log.info({
        event: "connector_runtime_execution",
        provider: result.provider,
        capability: result.capability,
        status: result.status,
        requestId: result.requestId,
        organizationId,
        durationMs: result.durationMs,
        ...(result.error ? { errorCode: result.error.code } : {}),
      });
      return reply.code(result.status === "succeeded" || result.status === "prepared" ? 200 : 502).send(publicConnectorResult(result));
    },
  );
}

function publicConnectorResult<T extends { provider: unknown }>(result: T): Omit<T, "provider"> {
  const safe = { ...result } as T & { provider?: unknown };
  delete safe.provider;
  return safe;
}

export async function persistMarketingConnectorOutcome(
  deps: ServerDeps,
  request: ConnectorExecutionRequest,
  capability: { readonly id: string; readonly providerToolId: string; readonly sideEffect: boolean },
  result: { readonly status: string; readonly output?: unknown; readonly error?: { readonly message: string } },
): Promise<{ taskId: string; resultId?: string } | null> {
  const workStore = deps.workStore;
  if (!workStore) return null;
  const now = new Date().toISOString();
  const workCapability = capability.id as DepartmentWorkCapability;
  const isSuccess = result.status === "succeeded";
  const isPrepared = result.status === "prepared";
  const task = await workStore.createTask({
    organizationId: request.organizationId,
    departmentId: "marketing",
    objectiveId: null,
    requestedBy: request.userId ?? "system",
    assignedEmployeeId: "agent_marketing_director",
    title: marketingConnectorTaskTitle(capability.id),
    summary: isSuccess
      ? "La operación de Marketing se ha completado con evidencia del proveedor."
      : isPrepared
        ? "La operación de Marketing está preparada y espera la autorización correspondiente."
        : "La operación de Marketing no se ha podido completar.",
    capability: workCapability,
    toolId: capability.providerToolId,
    status: isSuccess ? "completed" : isPrepared && capability.sideEffect ? "waiting_approval" : "failed",
    statusMessage: isSuccess ? "Operación completada" : isPrepared ? "Esperando aprobación" : "Operación fallida",
    progress: isSuccess ? 1 : isPrepared ? 0.5 : 0,
    requiredCapabilities: [workCapability],
    startedAt: now,
    completedAt: isSuccess || (!isPrepared && !capability.sideEffect) ? now : null,
    resultId: null,
    errorCode: result.error?.message ? "provider_unavailable" : null,
    errorMessage: result.error?.message ?? null,
    timeoutMs: 60_000,
  });

  let resultId: string | undefined;
  if (isSuccess || isPrepared) {
    const record = await workStore.createResult({
      organizationId: request.organizationId,
      departmentId: "marketing",
      relatedWorkItemId: task.id,
      title: marketingConnectorTaskTitle(capability.id),
      summary: isSuccess
        ? "Resultado verificado en la herramienta conectada."
        : "Resultado preparado; falta la aprobación para ejecutar el cambio.",
      content: safeConnectorContent(result.output),
      data: safeConnectorData(result.output),
      source: capability.providerToolId,
      producedByCapability: workCapability,
    });
    resultId = record.id;
    await workStore.updateTask(task.id, { resultId: record.id });
  }

  if (deps.marketingActivity) {
    await deps.marketingActivity.create({
      organizationId: request.organizationId,
      departmentId: "marketing",
      actor: "Elvira",
      type: isSuccess ? "resultado_generado" : isPrepared ? "aprobacion_solicitada" : "analisis_realizado",
      message: isSuccess
        ? `Elvira utilizó ${capability.providerToolId} y verificó el resultado.`
        : isPrepared
          ? `Elvira preparó una acción en ${capability.providerToolId} y solicita autorización.`
          : `Elvira no pudo completar la operación en ${capability.providerToolId}.`,
    });
  } else if (deps.marketing) {
    await deps.marketing.recordActivity(request.organizationId, {
      actor: "Elvira",
      kind: isSuccess ? "resultado_generado" : isPrepared ? "aprobacion_solicitada" : "analisis_realizado",
      message: isSuccess
        ? `Elvira utilizó ${capability.providerToolId} y verificó el resultado.`
        : isPrepared
          ? `Elvira preparó una acción en ${capability.providerToolId} y solicita autorización.`
          : `Elvira no pudo completar la operación en ${capability.providerToolId}.`,
    });
  }
  return { taskId: task.id, ...(resultId ? { resultId } : {}) };
}

function marketingConnectorTaskTitle(capability: string): string {
  const labels: Record<string, string> = {
    "marketing.wordpress.site.read": "Consulta del sitio WordPress",
    "marketing.wordpress.posts.list": "Publicaciones de WordPress",
    "marketing.wordpress.posts.get": "Lectura de publicación WordPress",
    "marketing.wordpress.posts.create": "Publicación WordPress",
    "marketing.wordpress.posts.update": "Actualización de WordPress",
    "marketing.shopify.shop.read": "Contexto de la tienda Shopify",
    "marketing.shopify.products.list": "Productos de Shopify",
    "marketing.shopify.products.get": "Lectura de producto Shopify",
    "marketing.shopify.products.create": "Producto Shopify",
    "marketing.shopify.products.update": "Actualización de producto Shopify",
    "marketing.shopify.orders.list": "Pedidos de Shopify",
    "marketing.shopify.orders.get": "Lectura de pedido Shopify",
    "marketing.shopify.customers.list": "Clientes de Shopify",
  };
  return labels[capability] ?? "Operación de Marketing";
}

function safeConnectorData(output: unknown): Readonly<Record<string, unknown>> {
  return Array.isArray(output) ? { items: output, count: output.length } : { value: output };
}

function safeConnectorContent(output: unknown): string {
  if (Array.isArray(output)) return `La herramienta devolvió ${output.length} registro(s).`;
  if (output && typeof output === "object") return "La herramienta devolvió un resultado estructurado verificado.";
  return output === undefined ? "La operación se completó sin datos adicionales." : "La herramienta devolvió un resultado verificado.";
}

async function firstToolState(
  deps: ServerDeps,
  organizationId: string,
  toolIds: readonly string[],
) {
  for (const toolId of toolIds) {
    const state = await deps.toolState?.get(organizationId, toolId);
    if (state) return state;
  }
  return null;
}

export function connectorRequestOrganizationId(
  request: FastifyRequest<{ Params: ConnectorParams }>,
): string {
  return request.params.organizationId;
}

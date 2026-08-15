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
} from "../../customer-zero/activepieces-connector.js";
import {
  credentialRequiredAdsResult,
  getAdsCapability,
  providerForAdsCapability,
  type AdsCapabilityDefinition,
} from "../../customer-zero/ads-capabilities.js";

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
      const legacyCapability = capability ? null : request.body.capability === "marketing.meta.ads.read" || request.body.capability === "marketing.meta.ads.manage"
        ? request.body.capability
        : null;
      if (!capability && !legacyCapability) {
        return reply.code(404).send({ error: "capability_not_registered" });
      }
      const operation = request.body.operation ?? "prepare";
      const input = request.body.input ?? {};
      const forbiddenInputKey = safeInput(input);
      if (forbiddenInputKey) {
        return reply.code(403).send({ error: { code: forbiddenInputKey === "organizationId" || forbiddenInputKey === "tenantId" ? "tenant_mismatch" : "credential_or_account_override" } });
      }
      if (!capability) {
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

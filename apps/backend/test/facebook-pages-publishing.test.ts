import { afterEach, describe, expect, it } from "vitest";
import type { ConnectorExecutionRequest, ConnectorExecutionResult, ConnectorHealthResult, ConnectorRuntime } from "@departify/connector-runtime";
import {
  prepareFacebookPagesPublication,
  resolvePendingFacebookPagesPublication,
} from "../src/customer-zero/facebook-pages-publishing.js";
import {
  getOrCreateCustomerZeroSession,
  resetCustomerZeroSessionsForTest,
} from "../src/customer-zero/customer-zero-session.js";
import type { MarketingService } from "../src/customer-zero/marketing-service.js";
import type { ApprovalRequest } from "../src/customer-zero/marketing-domain.js";

class FakeRuntime implements ConnectorRuntime {
  readonly provider = "activepieces" as const;
  readonly requests: ConnectorExecutionRequest[] = [];
  async health(): Promise<ConnectorHealthResult> {
    return { provider: "activepieces", healthy: true, status: 200, durationMs: 1 };
  }
  async execute<TOutput = unknown>(request: ConnectorExecutionRequest): Promise<ConnectorExecutionResult<TOutput>> {
    this.requests.push(request);
    const now = new Date().toISOString();
    return {
      requestId: request.requestId,
      organizationId: request.organizationId,
      provider: "activepieces",
      capability: request.capability,
      operation: request.operation,
      status: "succeeded",
      output: {} as TOutput,
      durationMs: 1,
      startedAt: now,
      completedAt: now,
    };
  }
}

function approval(status: ApprovalRequest["status"]): ApprovalRequest {
  return {
    id: "approval-social-1",
    departmentId: "marketing",
    from: "Elvira",
    title: "Publicar en Facebook Pages",
    detail: "Texto preparado",
    status,
    createdAt: new Date().toISOString(),
  };
}

function marketingStub(decided: ApprovalRequest["status"]): MarketingService {
  return {
    requestApproval: async () => approval("pending"),
    decideApproval: async () => approval(decided),
  } as unknown as MarketingService;
}

describe("Facebook Pages publication control plane", () => {
  afterEach(() => resetCustomerZeroSessionsForTest());

  it("does not prepare without a canonical granted social capability", async () => {
    const session = getOrCreateCustomerZeroSession("org-social-ungranted");
    const outcome = await prepareFacebookPagesPublication({
      session,
      marketing: marketingStub("pending"),
      content: "Nuevo producto",
    });
    expect(outcome.status).toBe("blocked");
    expect(outcome.reply).toContain("no está verificado");
  });

  it("prepares, then executes only after approval and a fresh connected grant", async () => {
    const session = getOrCreateCustomerZeroSession("org-social-approved");
    const connection = session.state.connections.get("meta_business") ?? {
      toolId: "meta_business",
      label: "Facebook Pages",
      capability: "marketing.publishing",
      category: "Marketing",
      status: "connected" as const,
      lifecycle: "connected" as const,
    };
    connection.status = "connected";
    connection.lifecycle = "connected";
    connection.verifiedAt = new Date().toISOString();
    connection.grantedCapabilities = ["marketing.social.publish"];
    session.state.connections.set("meta_business", connection);

    const marketing = marketingStub("approved");
    const prepared = await prepareFacebookPagesPublication({
      session,
      marketing,
      content: "  Nuevo producto  ",
    });
    expect(prepared.status).toBe("prepared");
    expect(session.state.pendingFacebookPagesWork?.status).toBe("awaiting_approval");

    const runtime = new FakeRuntime();
    const published = await resolvePendingFacebookPagesPublication({
      session,
      deps: { marketing, connectorRuntime: runtime },
      decision: "approve",
    });
    expect(published.status).toBe("published");
    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]).toMatchObject({
      organizationId: "org-social-approved",
      capability: "marketing.social.publish",
      operation: "execute",
      sideEffect: true,
      input: { content: "Nuevo producto", approvalId: "approval-social-1" },
    });
  });
});

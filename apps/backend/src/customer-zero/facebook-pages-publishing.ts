import {
  selectConnectorRuntime,
  type ConnectorExecutionResult,
  type ConnectorRuntime,
  type ConnectorRuntimeCandidate,
} from "@departify/connector-runtime";
import type { MarketingService } from "./marketing-service.js";
import type { CustomerZeroSession } from "./customer-zero-session.js";
import { hydrateSessionToolState } from "./customer-zero-session.js";

export const FACEBOOK_PAGES_PUBLISH_CAPABILITY = "marketing.social.publish";

export interface PendingFacebookPagesWork {
  readonly id: string;
  readonly approvalId: string;
  readonly content: string;
  status: "awaiting_approval" | "publishing" | "published" | "blocked" | "cancelled";
  readonly createdAt: string;
  error?: string;
}

export interface FacebookPagesPublicationOutcome {
  readonly status: "prepared" | "published" | "cancelled" | "blocked";
  readonly reply: string;
  readonly approvalId?: string;
  readonly execution?: ConnectorExecutionResult;
}

export interface FacebookPagesPublicationDeps {
  readonly marketing?: MarketingService;
  readonly connectorRuntime?: ConnectorRuntime;
  readonly connectorRuntimes?: readonly ConnectorRuntimeCandidate[];
  readonly userId?: string;
}

function isSpanish(session: CustomerZeroSession): boolean {
  return session.state.locale !== "en";
}

function businessSafeContent(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 2_000) : "";
}

function connectedWithCapability(session: CustomerZeroSession): boolean {
  const connection = session.state.connections.get("meta_business");
  return Boolean(
    connection?.lifecycle === "connected" &&
      connection.verifiedAt &&
      connection.grantedCapabilities?.includes(FACEBOOK_PAGES_PUBLISH_CAPABILITY),
  );
}

function publicationRuntime(deps: FacebookPagesPublicationDeps): ConnectorRuntime | undefined {
  return (
    selectConnectorRuntime(
      FACEBOOK_PAGES_PUBLISH_CAPABILITY,
      deps.connectorRuntimes ?? [],
    )?.candidate.runtime ?? deps.connectorRuntime
  );
}

export async function prepareFacebookPagesPublication(input: {
  readonly session: CustomerZeroSession;
  readonly marketing?: MarketingService;
  readonly content: unknown;
}): Promise<FacebookPagesPublicationOutcome> {
  const { session, marketing } = input;
  const content = businessSafeContent(input.content);
  const es = isSpanish(session);
  if (!content) {
    return {
      status: "blocked",
      reply: es ? "Necesito el texto que quieres preparar para Facebook." : "I need the text you want to prepare for Facebook.",
    };
  }
  await hydrateSessionToolState(session);
  if (!connectedWithCapability(session)) {
    return {
      status: "blocked",
      reply: es
        ? "Facebook Pages no está verificado para esta empresa. Conecta o vuelve a autorizar la conexión antes de preparar una publicación."
        : "Facebook Pages is not verified for this company. Connect or re-authorize it before preparing a post.",
    };
  }
  if (!marketing) {
    return {
      status: "blocked",
      reply: es ? "Marketing no está disponible temporalmente." : "Marketing is temporarily unavailable.",
    };
  }
  const approval = await marketing.requestApproval({
    organizationId: session.organizationId,
    title: es ? "Publicar en Facebook Pages" : "Publish to Facebook Pages",
    detail: content,
    locale: session.state.locale,
  });
  const work: PendingFacebookPagesWork = {
    id: `social_${Date.now().toString(36)}`,
    approvalId: approval.id,
    content,
    status: "awaiting_approval",
    createdAt: new Date().toISOString(),
  };
  session.state.pendingFacebookPagesWork = work;
  return {
    status: "prepared",
    approvalId: approval.id,
    reply: es
      ? "He preparado la publicación para Facebook Pages. Falta tu aprobación explícita antes de publicar."
      : "I prepared the Facebook Pages post. Your explicit approval is required before publishing.",
  };
}

export async function resolvePendingFacebookPagesPublication(input: {
  readonly session: CustomerZeroSession;
  readonly deps: FacebookPagesPublicationDeps;
  readonly decision: "approve" | "cancel";
}): Promise<FacebookPagesPublicationOutcome> {
  const { session, deps } = input;
  const work = session.state.pendingFacebookPagesWork;
  const es = isSpanish(session);
  if (!work || work.status !== "awaiting_approval") {
    return {
      status: "blocked",
      reply: es ? "No hay ninguna publicación de Facebook pendiente." : "There is no pending Facebook publication.",
    };
  }
  if (!deps.marketing) {
    return {
      status: "blocked",
      approvalId: work.approvalId,
      reply: es ? "Marketing no está disponible temporalmente." : "Marketing is temporarily unavailable.",
    };
  }
  if (input.decision === "cancel") {
    await deps.marketing.decideApproval(
      session.organizationId,
      work.approvalId,
      "reject",
      session.state.locale,
    );
    session.state.pendingFacebookPagesWork = { ...work, status: "cancelled" };
    return {
      status: "cancelled",
      approvalId: work.approvalId,
      reply: es ? "He cancelado la publicación de Facebook Pages." : "I cancelled the Facebook Pages post.",
    };
  }

  await hydrateSessionToolState(session);
  if (!connectedWithCapability(session)) {
    session.state.pendingFacebookPagesWork = {
      ...work,
      status: "blocked",
      error: "connection_not_verified",
    };
    return {
      status: "blocked",
      approvalId: work.approvalId,
      reply: es
        ? "No publico porque Facebook Pages ya no está verificado para esta empresa. Vuelve a autorizar la conexión."
        : "I did not publish because Facebook Pages is no longer verified for this company. Re-authorize the connection.",
    };
  }
  const approval = await deps.marketing.decideApproval(
    session.organizationId,
    work.approvalId,
    "approve",
    session.state.locale,
  );
  if (!approval || approval.status !== "approved") {
    return {
      status: "blocked",
      approvalId: work.approvalId,
      reply: es ? "La aprobación de Facebook no está disponible." : "The Facebook approval is not available.",
    };
  }
  const runtime = publicationRuntime(deps);
  if (!runtime) {
    session.state.pendingFacebookPagesWork = {
      ...work,
      status: "blocked",
      error: "runtime_not_configured",
    };
    return {
      status: "blocked",
      approvalId: work.approvalId,
      reply: es
        ? "La publicación está aprobada, pero Facebook Pages necesita configuración operativa antes de poder escribir. No se ha publicado nada."
        : "The post is approved, but Facebook Pages needs operational configuration before I can write. Nothing was published.",
    };
  }

  session.state.pendingFacebookPagesWork = { ...work, status: "publishing" };
  const execution = await runtime.execute({
    requestId: `social_${Date.now().toString(36)}`,
    organizationId: session.organizationId,
    ...(deps.userId ? { userId: deps.userId } : {}),
    capability: FACEBOOK_PAGES_PUBLISH_CAPABILITY,
    operation: "execute",
    input: { content: work.content, approvalId: work.approvalId },
    sideEffect: true,
  });
  if (execution.status !== "succeeded") {
    session.state.pendingFacebookPagesWork = {
      ...work,
      status: "blocked",
      error: execution.error?.code ?? "provider_error",
    };
    return {
      status: "blocked",
      approvalId: work.approvalId,
      execution,
      reply: es
        ? "La publicación no se ha confirmado por Facebook Pages; no la doy por hecha."
        : "Facebook Pages did not confirm the publication; I will not claim it was posted.",
    };
  }
  session.state.pendingFacebookPagesWork = { ...work, status: "published" };
  return {
    status: "published",
    approvalId: work.approvalId,
    execution,
    reply: es ? "La publicación se ha confirmado en Facebook Pages." : "The post was confirmed on Facebook Pages.",
  };
}

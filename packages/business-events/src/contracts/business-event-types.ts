/**
 * Business Event domain model — Sprint 27.
 *
 * The package is a pure composition layer. Events are validated and
 * dispatched through the `BusinessEventCatalog`; every handler delegates
 * to an existing runtime.
 */

export type BusinessEventId = string;
export type BusinessOrganizationId = string;
export type BusinessDepartmentId = string;
export type BusinessAgentId = string;

export const businessEventTypes = [
  "payment.confirmed",
  "lead.created",
  "organization.created",
  "organization.provisioned",
  "organization.discovery_requested",
  "organization.discovered",
] as const;

export type BusinessEventType = (typeof businessEventTypes)[number];

/**
 * Per-event payload. Hosts attach whatever data the event handler needs;
 * the catalog handler validates and forwards.
 */
export interface BusinessEventPayload {
  readonly [key: string]: unknown;
}

export interface BusinessEventBase {
  readonly eventId: BusinessEventId;
  readonly type: BusinessEventType;
  readonly occurredAt: Date;
  readonly organizationId?: BusinessOrganizationId;
  readonly departmentId?: BusinessDepartmentId;
  readonly actor?: BusinessAgentId;
  readonly payload: BusinessEventPayload;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * External payment confirmation (Sprint 49) — the entry point of the Vending
 * Machine. Emitted by Stripe (or a simulator that substitutes the external
 * event with the exact same shape) when a client pays for a plan. The handler
 * turns the paid customer into an organization, provisioning its Empresa
 * Digital.
 */
export interface PaymentConfirmedEvent extends BusinessEventBase {
  readonly type: "payment.confirmed";
  readonly paymentId: string;
  readonly organizationId: BusinessOrganizationId;
  readonly planId: string;
  readonly customerEmail?: string;
}

export interface LeadCreatedEvent extends BusinessEventBase {
  readonly type: "lead.created";
  readonly departmentId: BusinessDepartmentId;
  readonly leadId: string;
  readonly contactEmail: string;
}

export interface OrganizationCreatedEvent extends BusinessEventBase {
  readonly type: "organization.created";
  readonly organizationId: BusinessOrganizationId;
  readonly workspaceId: string;
  readonly organizationName: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface OrganizationProvisionedEvent extends BusinessEventBase {
  readonly type: "organization.provisioned";
  readonly organizationId: BusinessOrganizationId;
  readonly workspaceId: string;
  readonly provisioningId: string;
}

/**
 * Request to run the Executive Business Discovery Workflow (Sprint 31) for
 * an organization. Dispatched through the BusinessEventCatalog to the
 * existing `ExecutiveDiscoveryWorkflow`; the payload mirrors the workflow
 * input (Sprint 28 options).
 */
export interface OrganizationDiscoveryRequestedEvent extends BusinessEventBase {
  readonly type: "organization.discovery_requested";
  readonly organizationId: BusinessOrganizationId;
  readonly requestedBy: string;
  readonly includeFounderBrain?: boolean;
  readonly includeCompetitorAnalysis?: boolean;
  readonly includeMarketAnalysis?: boolean;
  readonly depth?: "basic" | "standard" | "comprehensive";
  readonly priority?: "low" | "normal" | "high";
}

/**
 * Fact event emitted once an organization has been discovered. Represents
 * the completed Business Discovery outcome (Sprint 28/31) as a business
 * fact other components can react to — the step before building the
 * organization's Empresa Digital.
 */
export interface OrganizationDiscoveredEvent extends BusinessEventBase {
  readonly type: "organization.discovered";
  readonly organizationId: BusinessOrganizationId;
  readonly sessionId: string;
  readonly discoveryExecutionId: string;
  readonly confidence: "low" | "medium" | "high";
  readonly gapCount: number;
  readonly questionCount: number;
}

export type BusinessEvent =
  | PaymentConfirmedEvent
  | LeadCreatedEvent
  | OrganizationCreatedEvent
  | OrganizationProvisionedEvent
  | OrganizationDiscoveryRequestedEvent
  | OrganizationDiscoveredEvent;

export class BusinessEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BusinessEventValidationError";
  }
}

export function validateBusinessEvent(event: unknown): BusinessEvent {
  if (typeof event !== "object" || event === null) {
    throw new BusinessEventValidationError("Business event must be an object.");
  }
  const candidate = event as Record<string, unknown>;
  const type = candidate.type;
  if (typeof type !== "string") {
    throw new BusinessEventValidationError(
      "Business event is missing its type discriminator.",
    );
  }
  if (!businessEventTypes.includes(type as BusinessEventType)) {
    throw new BusinessEventValidationError(
      `Business event type '${type}' is not registered.`,
    );
  }
  const eventId = candidate.eventId;
  if (typeof eventId !== "string" || eventId.trim().length === 0) {
    throw new BusinessEventValidationError(
      "Business event is missing a non-empty eventId.",
    );
  }
  const occurredAt = candidate.occurredAt;
  if (!(occurredAt instanceof Date) && typeof occurredAt !== "string") {
    throw new BusinessEventValidationError(
      "Business event is missing a valid occurredAt timestamp.",
    );
  }
  if (!candidate.payload || typeof candidate.payload !== "object") {
    throw new BusinessEventValidationError(
      "Business event is missing its payload object.",
    );
  }
  if (type === "payment.confirmed") {
    if (typeof candidate.paymentId !== "string") {
      throw new BusinessEventValidationError(
        "payment.confirmed requires a paymentId.",
      );
    }
    if (typeof candidate.organizationId !== "string") {
      throw new BusinessEventValidationError(
        "payment.confirmed requires an organizationId.",
      );
    }
    if (typeof candidate.planId !== "string") {
      throw new BusinessEventValidationError(
        "payment.confirmed requires a planId.",
      );
    }
  } else if (type === "lead.created") {
    if (typeof candidate.departmentId !== "string") {
      throw new BusinessEventValidationError(
        "lead.created requires a departmentId.",
      );
    }
    if (typeof candidate.leadId !== "string") {
      throw new BusinessEventValidationError("lead.created requires a leadId.");
    }
    if (typeof candidate.contactEmail !== "string") {
      throw new BusinessEventValidationError(
        "lead.created requires a contactEmail.",
      );
    }
  } else if (type === "organization.created") {
    if (typeof candidate.organizationId !== "string") {
      throw new BusinessEventValidationError(
        "organization.created requires an organizationId.",
      );
    }
    if (typeof candidate.workspaceId !== "string") {
      throw new BusinessEventValidationError(
        "organization.created requires a workspaceId.",
      );
    }
    if (typeof candidate.organizationName !== "string") {
      throw new BusinessEventValidationError(
        "organization.created requires an organizationName.",
      );
    }
  } else if (type === "organization.provisioned") {
    if (typeof candidate.organizationId !== "string") {
      throw new BusinessEventValidationError(
        "organization.provisioned requires an organizationId.",
      );
    }
    if (typeof candidate.workspaceId !== "string") {
      throw new BusinessEventValidationError(
        "organization.provisioned requires a workspaceId.",
      );
    }
    if (typeof candidate.provisioningId !== "string") {
      throw new BusinessEventValidationError(
        "organization.provisioned requires a provisioningId.",
      );
    }
  } else if (type === "organization.discovery_requested") {
    if (typeof candidate.organizationId !== "string") {
      throw new BusinessEventValidationError(
        "organization.discovery_requested requires an organizationId.",
      );
    }
    if (typeof candidate.requestedBy !== "string") {
      throw new BusinessEventValidationError(
        "organization.discovery_requested requires a requestedBy.",
      );
    }
    const depth = candidate.depth;
    if (
      depth !== undefined &&
      (typeof depth !== "string" ||
        !["basic", "standard", "comprehensive"].includes(depth))
    ) {
      throw new BusinessEventValidationError(
        "organization.discovery_requested has an invalid depth.",
      );
    }
    const priority = candidate.priority;
    if (
      priority !== undefined &&
      (typeof priority !== "string" ||
        !["low", "normal", "high"].includes(priority))
    ) {
      throw new BusinessEventValidationError(
        "organization.discovery_requested has an invalid priority.",
      );
    }
  } else if (type === "organization.discovered") {
    if (typeof candidate.organizationId !== "string") {
      throw new BusinessEventValidationError(
        "organization.discovered requires an organizationId.",
      );
    }
    if (typeof candidate.sessionId !== "string") {
      throw new BusinessEventValidationError(
        "organization.discovered requires a sessionId.",
      );
    }
    if (typeof candidate.discoveryExecutionId !== "string") {
      throw new BusinessEventValidationError(
        "organization.discovered requires a discoveryExecutionId.",
      );
    }
    const confidence = candidate.confidence;
    if (
      typeof confidence !== "string" ||
      !["low", "medium", "high"].includes(confidence)
    ) {
      throw new BusinessEventValidationError(
        "organization.discovered requires a valid confidence.",
      );
    }
    if (typeof candidate.gapCount !== "number" || candidate.gapCount < 0) {
      throw new BusinessEventValidationError(
        "organization.discovered requires a non-negative gapCount.",
      );
    }
    if (
      typeof candidate.questionCount !== "number" ||
      candidate.questionCount < 0
    ) {
      throw new BusinessEventValidationError(
        "organization.discovered requires a non-negative questionCount.",
      );
    }
  }
  return candidate as unknown as BusinessEvent;
}

export function normaliseOccurredAt(event: BusinessEvent): Date {
  return event.occurredAt instanceof Date
    ? event.occurredAt
    : new Date(event.occurredAt);
}

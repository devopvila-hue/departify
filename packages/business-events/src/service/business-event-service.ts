import type {
  BusinessEventHandlerContext,
  BusinessEventHandlerOutcome,
  BusinessEventCatalog,
} from "../catalog/business-event-catalog.js";
import {
  buildBusinessEventResult,
  type BusinessEventError,
  type BusinessEventResult,
} from "../contracts/business-event-result.js";
import type { BusinessEvent } from "../contracts/business-event-types.js";
import {
  BusinessEventValidationError,
  validateBusinessEvent,
} from "../contracts/business-event-types.js";

/**
 * BusinessEventService — the single composition entry point for
 * business events. Hosts publish events through `publish(event)` and the
 * service resolves them through the catalog into existing runtimes.
 *
 * The service is idempotent: re-publishing the same `eventId` returns the
 * cached result without re-executing the workflow / provisioning step.
 */
export interface BusinessEventServiceOptions {
  readonly catalog: BusinessEventCatalog;
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
}

export class BusinessEventService {
  private readonly catalog: BusinessEventCatalog;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly handlerContext: BusinessEventHandlerContext;
  private readonly results = new Map<string, BusinessEventResult>();

  constructor(options: BusinessEventServiceOptions) {
    this.catalog = options.catalog;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.handlerContext = {
      now: this.clock,
      eventId: this.idFactory,
      workflowId: this.idFactory,
      executionId: this.idFactory,
    };
  }

  /**
   * Publishes an event through the catalog. Returns the typed result
   * without throwing.
   */
  async publish(eventInput: unknown): Promise<BusinessEventResult> {
    const startedAt = this.clock();
    let event: BusinessEvent;
    try {
      event = validateBusinessEvent(eventInput);
    } catch (cause) {
      const completedAt = this.clock();
      const validationError: BusinessEventError = {
        code:
          cause instanceof BusinessEventValidationError
            ? "validation_failed"
            : "validation_error",
        message: cause instanceof Error ? cause.message : String(cause),
        phase: "validation",
      };
      const fallbackEventId = this.coerceId(eventInput) ?? this.idFactory();
      return buildBusinessEventResult({
        eventId: fallbackEventId,
        eventType: "organization.created",
        status: "rejected",
        output: null,
        errors: [validationError],
        idempotent: false,
        startedAt,
        completedAt,
      });
    }

    const cached = this.results.get(event.eventId);
    if (cached) {
      return { ...cached, idempotent: true };
    }

    const handler = this.catalog.tryResolve(event.type);
    if (!handler) {
      const completedAt = this.clock();
      const result = buildBusinessEventResult({
        eventId: event.eventId,
        eventType: event.type,
        ...(event.organizationId
          ? { organizationId: event.organizationId }
          : {}),
        ...("departmentId" in event && event.departmentId
          ? { departmentId: event.departmentId }
          : {}),
        status: "rejected",
        output: null,
        errors: [
          {
            code: "BUSINESS_EVENT_UNKNOWN",
            message: `No handler registered for event type '${event.type}'.`,
            phase: "catalog",
          },
        ],
        idempotent: false,
        startedAt,
        completedAt,
      });
      this.results.set(event.eventId, result);
      return result;
    }

    let outcome: BusinessEventHandlerOutcome;
    try {
      outcome = await handler(event, this.handlerContext);
    } catch (cause) {
      const completedAt = this.clock();
      const errorEnvelope: BusinessEventError = {
        code: "delegation_failed",
        message: cause instanceof Error ? cause.message : String(cause),
        phase: "delegation",
      };
      const result = buildBusinessEventResult({
        eventId: event.eventId,
        eventType: event.type,
        ...(event.organizationId
          ? { organizationId: event.organizationId }
          : {}),
        ...("departmentId" in event && event.departmentId
          ? { departmentId: event.departmentId }
          : {}),
        status: "failed",
        output: null,
        errors: [errorEnvelope],
        idempotent: false,
        startedAt,
        completedAt,
      });
      this.results.set(event.eventId, result);
      return result;
    }

    const completedAt = this.clock();
    const result = buildBusinessEventResult({
      eventId: event.eventId,
      eventType: event.type,
      ...(event.organizationId ? { organizationId: event.organizationId } : {}),
      ...("departmentId" in event && event.departmentId
        ? { departmentId: event.departmentId }
        : {}),
      ...(outcome.workflowId ? { workflowId: outcome.workflowId } : {}),
      ...(outcome.executionId ? { executionId: outcome.executionId } : {}),
      ...(outcome.provisioningId
        ? { provisioningId: outcome.provisioningId }
        : {}),
      status: outcome.status,
      output: outcome.output,
      errors: outcome.errors,
      idempotent: false,
      startedAt,
      completedAt,
    });
    this.results.set(event.eventId, result);
    return result;
  }

  /**
   * Re-emits a previously published event by replaying its stored
   * outcome. Used by hosts that want to surface the cached result
   * through a different channel (e.g., webhook) without re-running.
   */
  replay(eventId: string): BusinessEventResult | null {
    return this.results.get(eventId) ?? null;
  }

  /**
   * Returns the previously persisted result for an eventId when the
   * event was processed. Useful for tests and idempotent callers.
   */
  getResult(eventId: string): BusinessEventResult | null {
    return this.results.get(eventId) ?? null;
  }

  private coerceId(input: unknown): string | null {
    if (
      typeof input === "object" &&
      input !== null &&
      "eventId" in input &&
      typeof (input as { eventId: unknown }).eventId === "string"
    ) {
      return (input as { eventId: string }).eventId;
    }
    return null;
  }
}

function defaultIdFactory(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

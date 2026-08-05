export const organizationEventTypes = [
  "organization.requested",
  "organization.created",
  "organization.activated",
  "organization.suspended",
  "organization.archived",
  "organization.deleted",
] as const;

export type OrganizationEventType = (typeof organizationEventTypes)[number];

export interface OrganizationDomainEvent<TType extends OrganizationEventType> {
  type: TType;
  organizationId: string;
  occurredAt: Date;
}

export interface OrganizationRequestedEvent extends OrganizationDomainEvent<"organization.requested"> {
  organizationName: string;
}

export type OrganizationCreatedEvent =
  OrganizationDomainEvent<"organization.created">;

export type OrganizationActivatedEvent =
  OrganizationDomainEvent<"organization.activated">;

export interface OrganizationSuspendedEvent extends OrganizationDomainEvent<"organization.suspended"> {
  reason: string;
}

export interface OrganizationArchivedEvent extends OrganizationDomainEvent<"organization.archived"> {
  reason: string;
}

export interface OrganizationDeletedEvent extends OrganizationDomainEvent<"organization.deleted"> {
  reason: string;
}

export type OrganizationEvent =
  | OrganizationRequestedEvent
  | OrganizationCreatedEvent
  | OrganizationActivatedEvent
  | OrganizationSuspendedEvent
  | OrganizationArchivedEvent
  | OrganizationDeletedEvent;

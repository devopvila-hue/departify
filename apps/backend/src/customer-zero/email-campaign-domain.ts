/**
 * Email Campaign domain — Customer Zero 02.
 *
 * The durable model for outbound email campaigns. Re-uses the
 * DepartmentTask / DepartmentResult pattern from Customer Zero 01.
 * The campaign executor runs through the same DepartmentWorkExecutor.
 *
 * Critical rules:
 *   - Bulk send is STRUCTURALLY blocked when status != "approved".
 *   - Recipients are filtered against the suppression list before
 *     any provider call.
 *   - Sequence step limits (≤ 3 steps) are enforced at the input
 *     boundary.
 *   - From / Reply-To headers are sanitized to prevent injection.
 */

import type { SupportedLocale } from "./locale.js";

/* ----------------------------------------------------------------------------
 * Status machine.
 * --------------------------------------------------------------------------*/

export type EmailCampaignStatus =
  | "draft"
  | "ready_for_approval"
  | "approved"
  | "sending"
  | "sent"
  | "partial"
  | "failed";

export const EMAIL_CAMPAIGN_STATUSES: readonly EmailCampaignStatus[] = [
  "draft",
  "ready_for_approval",
  "approved",
  "sending",
  "sent",
  "partial",
  "failed",
];

/** Returns true when a campaign may be sent (structurally). */
export function canSendCampaign(status: EmailCampaignStatus): boolean {
  return status === "approved";
}

/** Maximum sequence steps this sprint ships with. */
export const EMAIL_SEQUENCE_MAX_STEPS = 3;

/* ----------------------------------------------------------------------------
 * Audience.
 * --------------------------------------------------------------------------*/

export type AudienceSource =
  | { readonly kind: "mautic_segment"; readonly segmentId: number; readonly label: string }
  | { readonly kind: "mautic_filter"; readonly filter: string; readonly label: string }
  | { readonly kind: "static"; readonly emails: readonly string[] };

export interface NormalizedRecipient {
  readonly email: string;
  readonly displayName?: string;
}

/* ----------------------------------------------------------------------------
 * Sequence.
 * --------------------------------------------------------------------------*/

export interface EmailSequenceStep {
  readonly id: string;
  readonly orderIndex: number;
  readonly subject: string;
  readonly bodyText: string;
  /** Delay in hours before sending this step (relative to the previous). */
  readonly delayHours: number;
}

export interface EmailSequence {
  readonly id: string;
  readonly steps: readonly EmailSequenceStep[];
}

/* ----------------------------------------------------------------------------
 * Campaign.
 * --------------------------------------------------------------------------*/

export interface EmailCampaign {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: "marketing";
  readonly objectiveId: string | null;
  readonly name: string;
  readonly audience: AudienceSource;
  readonly sequence: EmailSequence;
  readonly from: string;
  readonly replyTo: string | null;
  readonly status: EmailCampaignStatus;
  readonly recipientCount: number;
  readonly provider: "resend";
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly approvedBy: string | null;
  readonly sentAt: string | null;
  readonly completedAt: string | null;
  readonly relatedWorkItemId: string | null;
  readonly errorMessage: string | null;
}

/* ----------------------------------------------------------------------------
 * Suppression list.
 * --------------------------------------------------------------------------*/

export type SuppressionReason =
  | "unsubscribed"
  | "hard_bounced"
  | "complained"
  | "manual";

export interface SuppressionEntry {
  readonly organizationId: string;
  readonly email: string;
  readonly reason: SuppressionReason;
  readonly createdAt: string;
}

/** In-memory store. Tests + Customer Zero bootstrap. Production
 *  should swap in a Supabase adapter. */
class SuppressionStore {
  private readonly entries: SuppressionEntry[] = [];

  add(entry: SuppressionEntry): void {
    const key = `${entry.organizationId}::${entry.email.toLowerCase()}`;
    if (
      this.entries.find(
        (e) => `${e.organizationId}::${e.email.toLowerCase()}` === key,
      )
    ) {
      return;
    }
    this.entries.push(entry);
  }

  isSuppressed(organizationId: string, email: string): boolean {
    const key = `${organizationId}::${email.toLowerCase()}`;
    return this.entries.some(
      (e) => `${e.organizationId}::${e.email.toLowerCase()}` === key,
    );
  }

  list(organizationId: string): readonly SuppressionEntry[] {
    return this.entries.filter((e) => e.organizationId === organizationId);
  }
}

export const suppressionStore = new SuppressionStore();

/* ----------------------------------------------------------------------------
 * Campaign store + executor input builder.
 * --------------------------------------------------------------------------*/

export interface CreateCampaignInput {
  readonly organizationId: string;
  readonly objectiveId: string | null;
  readonly name: string;
  readonly audience: AudienceSource;
  readonly sequence: EmailSequence;
  readonly from: string;
  readonly replyTo?: string;
}

export interface UpdateCampaignStatusInput {
  readonly campaignId: string;
  readonly status: EmailCampaignStatus;
  readonly approvedBy?: string;
  readonly sentAt?: string;
  readonly completedAt?: string;
  readonly relatedWorkItemId?: string;
  readonly errorMessage?: string;
}

export interface EmailCampaignStore {
  create(input: CreateCampaignInput): Promise<EmailCampaign>;
  get(id: string): Promise<EmailCampaign | null>;
  list(organizationId: string): Promise<EmailCampaign[]>;
  updateStatus(input: UpdateCampaignStatusInput): Promise<EmailCampaign>;
  /** Append a recipient count after audience resolution. */
  setRecipientCount(id: string, count: number): Promise<EmailCampaign>;
}

/* ----------------------------------------------------------------------------
 * In-memory implementation.
 * --------------------------------------------------------------------------*/

export class InMemoryEmailCampaignStore implements EmailCampaignStore {
  private readonly map = new Map<string, EmailCampaign>();

  async create(input: CreateCampaignInput): Promise<EmailCampaign> {
    const id = `cmp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const campaign: EmailCampaign = {
      id,
      organizationId: input.organizationId,
      departmentId: "marketing",
      objectiveId: input.objectiveId,
      name: input.name,
      audience: input.audience,
      sequence: input.sequence,
      from: input.from,
      replyTo: input.replyTo ?? null,
      status: "draft",
      recipientCount: 0,
      provider: "resend",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
      sentAt: null,
      completedAt: null,
      relatedWorkItemId: null,
      errorMessage: null,
    };
    this.map.set(id, campaign);
    return campaign;
  }

  async get(id: string): Promise<EmailCampaign | null> {
    return this.map.get(id) ?? null;
  }

  async list(organizationId: string): Promise<EmailCampaign[]> {
    return [...this.map.values()].filter((c) => c.organizationId === organizationId);
  }

  async updateStatus(input: UpdateCampaignStatusInput): Promise<EmailCampaign> {
    const existing = this.map.get(input.campaignId);
    if (!existing) {
      throw new EmailCampaignError("campaign_not_found", "Campaña no encontrada.");
    }
    const next: EmailCampaign = {
      ...existing,
      status: input.status,
      ...(input.approvedBy ? { approvedAt: new Date().toISOString(), approvedBy: input.approvedBy } : {}),
      ...(input.sentAt ? { sentAt: input.sentAt } : {}),
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      ...(input.relatedWorkItemId ? { relatedWorkItemId: input.relatedWorkItemId } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    };
    this.map.set(existing.id, next);
    return next;
  }

  async setRecipientCount(id: string, count: number): Promise<EmailCampaign> {
    const existing = this.map.get(id);
    if (!existing) {
      throw new EmailCampaignError("campaign_not_found", "Campaña no encontrada.");
    }
    const next: EmailCampaign = { ...existing, recipientCount: count };
    this.map.set(id, next);
    return next;
  }
}

/* ----------------------------------------------------------------------------
 * Errors.
 * --------------------------------------------------------------------------*/

export class EmailCampaignError extends Error {
  constructor(
    public readonly code:
      | "campaign_not_found"
      | "approval_required"
      | "sequence_too_long"
      | "audience_invalid"
      | "sender_invalid",
    message: string,
  ) {
    super(message.slice(0, 200));
    this.name = "EmailCampaignError";
  }
}

/* ----------------------------------------------------------------------------
 * Helpers.
 * --------------------------------------------------------------------------*/

export function buildStatusLabel(
  status: EmailCampaignStatus,
  locale: SupportedLocale,
): string {
  const es = locale !== "en";
  switch (status) {
    case "draft":
      return es ? "Borrador" : "Draft";
    case "ready_for_approval":
      return es ? "Esperando aprobación" : "Awaiting approval";
    case "approved":
      return es ? "Aprobada" : "Approved";
    case "sending":
      return es ? "Enviando" : "Sending";
    case "sent":
      return es ? "Enviada" : "Sent";
    case "partial":
      return es ? "Envío parcial" : "Partial";
    case "failed":
      return es ? "Fallida" : "Failed";
  }
}

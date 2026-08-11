/**
 * Unified Inbox domain — Customer Zero 03.
 *
 * Departify-owned normalized representation of incoming business
 * communication. The InboxItem is the single canonical shape the
 * Portal consumes; Gmail / Outlook / IMAP / Drive / forms all map
 * into this shape.
 *
 * The shape is intentionally minimal. It carries only business-
 * useful fields. Provider payloads (Gmail API JSON, Drive
 * metadata, raw MIME) live behind the adapter and never leak
 * into the Portal domain.
 *
 * V1 channels: `email` (the Customer Zero priority). Other
 * channels (lead, campaign_response, form, support) share the
 * same shape but are not fully populated yet. The architecture
 * supports them.
 */

export type InboxChannel = "email" | "lead" | "campaign_response" | "form" | "support" | "other";

export type InboxCategory =
  | "lead"
  | "customer_question"
  | "campaign_response"
  | "support"
  | "administrative"
  | "unknown";

export type InboxItemState =
  | "received"
  | "classified"
  | "routed"
  | "in_work"
  | "resolved"
  | "archived";

export interface InboxAddress {
  readonly email: string;
  readonly displayName?: string;
}

export interface InboxItem {
  readonly id: string;
  readonly organizationId: string;
  /** Provider identifier (e.g. "gmail"). */
  readonly source: string;
  /** Provider-stable message id (so we can deduplicate). */
  readonly sourceMessageId: string;
  /** Provider thread id, when the channel has threads (email). */
  readonly sourceThreadId?: string;
  readonly channel: InboxChannel;
  readonly category: InboxCategory;
  readonly subject: string;
  readonly sender: InboxAddress;
  readonly recipients: readonly InboxAddress[];
  readonly cc?: readonly InboxAddress[];
  /** Plain-text body — provider payloads are stripped of HTML. */
  readonly plainText: string;
  /** Original HTML body, retained for a sanitized read view only. */
  readonly htmlBody?: string;
  /** Short preview for the Portal list view. */
  readonly preview: string;
  readonly attachments?: readonly {
    readonly filename?: string;
    readonly mimeType?: string;
    readonly size?: number;
  }[];
  readonly mailbox?: string;
  readonly folder?: string;
  readonly receivedAt: string;
  readonly unread: boolean;
  /** 0..1, computed at classification time. */
  readonly importance: number;
  /** Where Departify routes this item. */
  readonly departmentId: string | null;
  /** When the classifier recognized it as a possible lead. */
  readonly isLead: boolean;
  /** Work / task created from this item, if any. */
  readonly relatedWorkItemId: string | null;
  /** Conversation id, if a chat thread was opened. */
  readonly relatedConversationId: string | null;
  /** Free-form provenance (where the item came from). */
  readonly provenance: {
    readonly provider: string;
    readonly rawEventId?: string;
  };
  readonly state: InboxItemState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ----------------------------------------------------------------------------
 * Classification — deterministic, no LLM.
 *
 * V1 uses keyword heuristics + sender/recipient pattern matching.
 * The classifier returns the category, importance, lead flag, and
 * the responsible department.
 * --------------------------------------------------------------------------*/

export interface InboxClassification {
  readonly category: InboxCategory;
  readonly importance: number;
  readonly isLead: boolean;
  readonly departmentId: string | null;
  readonly rationale: string;
}

const LEAD_KEYWORDS_EN = [
  "interested in",
  "pricing",
  "quote",
  "demo",
  "how does",
  "more information",
  "your service",
  "your product",
  "trial",
  "sign up",
];

const LEAD_KEYWORDS_ES = [
  "me interesa",
  "información",
  "más información",
  "cómo funciona",
  "vuestro servicio",
  "vuestro producto",
  "precio",
  "presupuesto",
  "demo",
  "contratar",
  "probar",
  "alta",
  "registrarme",
];

const CUSTOMER_QUESTION_KEYWORDS_EN = [
  "how do i",
  "where is",
  "support",
  "help with",
  "issue with",
  "problem with",
];

const CUSTOMER_QUESTION_KEYWORDS_ES = [
  "cómo puedo",
  "dónde está",
  "soporte",
  "ayuda con",
  "tengo un problema",
  "tengo una duda",
  "consulta",
];

const CAMPAIGN_KEYWORDS_EN = [
  "unsubscribe",
  "stop emailing",
  "remove me from",
];

const CAMPAIGN_KEYWORDS_ES = [
  "darme de baja",
  "no deseo recibir",
  "no quiero recibir",
  "cancelar suscripción",
  "baja del boletín",
];

const SUPPORT_KEYWORDS_EN = ["error", "broken", "doesn't work", "not working"];
const SUPPORT_KEYWORDS_ES = [
  "no funciona",
  "está roto",
  "error",
  "no me deja",
  "no puedo",
];

/**
 * Deterministic classifier. No LLM. Returns the InboxCategory +
 * importance (0..1) + lead flag + responsible department.
 *
 * Marketing is the only department today (Customer Zero 02 / 03
 * scope). When additional departments are added, this classifier
 * learns to route to them by adding more `department` matches.
 */
export function classifyInboxItem(input: {
  readonly subject: string;
  readonly plainText: string;
  readonly fromEmail: string;
  readonly toEmails: readonly string[];
}): InboxClassification {
  const haystack = `${input.subject}\n${input.plainText}`.toLowerCase();

  let importance = 0.4;
  let isLead = false;
  const departmentId: string | null = "marketing";
  let category: InboxCategory = "unknown";
  let rationale = "Clasificación inicial por defecto.";

  if (anyContains(haystack, CAMPAIGN_KEYWORDS_EN) || anyContains(haystack, CAMPAIGN_KEYWORDS_ES)) {
    category = "campaign_response";
    importance = 0.5;
    rationale = "Mensaje parece relacionado con una campaña existente.";
  } else if (anyContains(haystack, LEAD_KEYWORDS_EN) || anyContains(haystack, LEAD_KEYWORDS_ES)) {
    category = "lead";
    isLead = true;
    importance = 0.85;
    rationale = "Mensaje sugiere una oportunidad de cliente potencial.";
  } else if (anyContains(haystack, CUSTOMER_QUESTION_KEYWORDS_EN) || anyContains(haystack, CUSTOMER_QUESTION_KEYWORDS_ES)) {
    category = "customer_question";
    importance = 0.7;
    rationale = "Mensaje parece una consulta de un cliente.";
  } else if (anyContains(haystack, SUPPORT_KEYWORDS_EN) || anyContains(haystack, SUPPORT_KEYWORDS_ES)) {
    category = "support";
    importance = 0.65;
    rationale = "Mensaje parece una solicitud de soporte.";
  } else {
    rationale = "Sin patrones claros; clasificado como administrativo.";
    category = "administrative";
    importance = 0.3;
  }

  // External email (someone contacting the company) is more
  // important than an internal reply.
  const isExternal = !input.toEmails.some((addr) =>
    addr.toLowerCase().endsWith("@departify.app"),
  );
  if (isExternal && category !== "administrative") {
    importance = Math.min(1, importance + 0.1);
  }

  return {
    category,
    importance,
    isLead,
    departmentId,
    rationale,
  };
}

function anyContains(haystack: string, needles: readonly string[]): boolean {
  for (const needle of needles) {
    if (haystack.includes(needle)) return true;
  }
  return false;
}

/* ----------------------------------------------------------------------------
 * InboxStore — durable per-org inbox.
 * --------------------------------------------------------------------------*/

export interface InboxStore {
  upsert(item: Omit<InboxItem, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  }): Promise<InboxItem>;
  get(id: string): Promise<InboxItem | null>;
  list(input: {
    organizationId: string;
    category?: InboxCategory;
    state?: InboxItemState;
    limit?: number;
  }): Promise<InboxItem[]>;
  setState(id: string, state: InboxItemState): Promise<InboxItem>;
  setClassification(id: string, classification: InboxClassification): Promise<InboxItem>;
  setRelatedWorkItem(id: string, workItemId: string | null): Promise<InboxItem>;
}

export class InMemoryInboxStore implements InboxStore {
  private readonly items = new Map<string, InboxItem>();

  async upsert(
    item: Omit<InboxItem, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<InboxItem> {
    const now = new Date().toISOString();
    // Dedupe by (organizationId, source, sourceMessageId).
    const existing = [...this.items.values()].find(
      (candidate) =>
        candidate.organizationId === item.organizationId &&
        candidate.source === item.source &&
        candidate.sourceMessageId === item.sourceMessageId,
    );
    if (existing) {
      const next: InboxItem = {
        ...existing,
        ...item,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      this.items.set(existing.id, next);
      return next;
    }
    const id = item.id ?? `inbox_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const created: InboxItem = {
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(id, created);
    return created;
  }

  async get(id: string): Promise<InboxItem | null> {
    return this.items.get(id) ?? null;
  }

  async list(input: {
    organizationId: string;
    category?: InboxCategory;
    state?: InboxItemState;
    limit?: number;
  }): Promise<InboxItem[]> {
    const all = [...this.items.values()].filter(
      (item) => item.organizationId === input.organizationId,
    );
    const filtered = all.filter((item) => {
      if (input.category && item.category !== input.category) return false;
      if (input.state && item.state !== input.state) return false;
      return true;
    });
    filtered.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return filtered.slice(0, input.limit ?? 50);
  }

  async setState(id: string, state: InboxItemState): Promise<InboxItem> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`InboxItem ${id} not found`);
    const next: InboxItem = {
      ...existing,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, next);
    return next;
  }

  async setClassification(
    id: string,
    classification: InboxClassification,
  ): Promise<InboxItem> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`InboxItem ${id} not found`);
    const next: InboxItem = {
      ...existing,
      category: classification.category,
      importance: classification.importance,
      isLead: classification.isLead,
      departmentId: classification.departmentId,
      state: "classified",
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, next);
    return next;
  }

  async setRelatedWorkItem(
    id: string,
    workItemId: string | null,
  ): Promise<InboxItem> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`InboxItem ${id} not found`);
    const next: InboxItem = {
      ...existing,
      relatedWorkItemId: workItemId,
      state: workItemId ? "in_work" : existing.state,
      updatedAt: new Date().toISOString(),
    };
    this.items.set(id, next);
    return next;
  }
}

/* ----------------------------------------------------------------------------
 * Preview helper.
 * --------------------------------------------------------------------------*/

export function buildPreview(plainText: string, maxChars = 240): string {
  const trimmed = plainText.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

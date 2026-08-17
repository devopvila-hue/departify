/**
 * DepartmentWork — Customer Zero 01 P0.
 *
 * The durable layer that closes the asynchronous work loop:
 *
 *   CEO: "Analiza los 2.260 contactos y prepara un informe."
 *   Elvira: "Voy a hacerlo. Te dejo el informe en Resultados."
 *   → DepartmentTask created (status=running).
 *   → Background work runs (capability.execute).
 *   → DepartmentResult published (via results.publish capability).
 *   → Task marked completed.
 *   → Activity recorded.
 *   → Final message auto-injected into the conversation.
 *   → Portal sees the final message WITHOUT requiring the CEO to ask
 *     "¿ya está?".
 *
 * Critical guarantees:
 *   - The model cannot promise work the system cannot deliver.
 *   - State survives page reloads, backend restarts, and engine
 *     restarts (via the durable store).
 *   - Tasks that exceed a timeout surface as failed/needs_attention.
 *   - The chat shows real work states, not fake timers.
 */

import type { SupportedLocale } from "./locale.js";

/* ----------------------------------------------------------------------------
 * Status machine.
 * --------------------------------------------------------------------------*/

export type DepartmentWorkStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export const DEPARTMENT_WORK_STATUSES: readonly DepartmentWorkStatus[] = [
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
];

/* ----------------------------------------------------------------------------
 * Capability gating — what the model is allowed to promise.
 * --------------------------------------------------------------------------*/

export type DepartmentWorkCapability =
  | "crm.contacts.list"
  | "crm.contacts.summary"
  | "crm.segments.list"
  | "crm.campaigns.list"
  | "results.publish"
  | "memory.remember"
  | "marketing.wordpress.connection.test"
  | "marketing.wordpress.site.read"
  | "marketing.wordpress.posts.list"
  | "marketing.wordpress.posts.get"
  | "marketing.wordpress.posts.create"
  | "marketing.wordpress.posts.update"
  | "marketing.wordpress.categories.list"
  | "marketing.wordpress.tags.list"
  | "marketing.shopify.connection.test"
  | "marketing.shopify.shop.read"
  | "marketing.shopify.products.list"
  | "marketing.shopify.products.get"
  | "marketing.shopify.products.create"
  | "marketing.shopify.products.update"
  | "marketing.shopify.orders.list"
  | "marketing.shopify.orders.get"
  | "marketing.shopify.customers.list"
  | "seo.audit.website"
  | "seo.repository.read"
  | "drive.workspace.create";

/** Departments of work the model is NOT allowed to promise today. */
export const UNSUPPORTED_PROMISE_PATTERNS: readonly RegExp[] = [
  /\bte\s+(lo\s+)?(traigo|presento|envío|aviso|mando)\s+(luego|ahora|en\s+un\s+momento|mañana|después)\b/i,
  /\blo\s+(dejo|dejare|dejaré|dejamos)\s+(en\s+resultados|en\s+actividades|listo|fijado|en\s+la\s+secci[oó]n)\b/i,
  /\bte\s+(confirmo|avisar[ée]|informaré|notificar[ée]|escribo|escribimos)\s+cuando\b/i,
  /\bte\s+aviso\s+(cuando|en\s+cuanto)\b/i,
  /\bte\s+(lo\s+)?(traigo|presento|mando)\s+en\s+cuanto\b/i,
  /\blo\s+(dejo|dejare|dejaré)\s+fijado\b/i,
];

/** Claims that describe execution already underway without naming a durable
 * task/result. The control plane may only allow these when it can point to
 * new persisted work created by the current request. */
export const UNBACKED_WORK_CLAIM_PATTERNS: readonly RegExp[] = [
  /\blo\s+estoy\s+(haciendo|extrayendo|generando|preparando|analizando|trabajando)\b/i,
  /\b(?:extrayendo|aplicando\s+el\s+scoring|generando\s+el\s+gr[aá]fico|generando\s+el\s+dashboard)\b/i,
  /\bdame\s+unos\s+minutos\b/i,
  /\bte\s+lo\s+(?:entrego|dejo)\s+(?:en\s+)?(?:unos\s+minutos|resultados)\b/i,
  /\b(?:estar[aá]|est[aá])\s+(?:disponible|listo|colgado)\b/i,
  /\by[aá]\s+estoy\s+trabajando\s+en\s+ello\b/i,
];

/** True when a CEO reply contains a "promise without capability"
 *  pattern. The orchestrator must replace the engine's reply with
 *  an honest business-language fallback in that case. */
export function detectUnsupportedPromise(reply: string): boolean {
  return UNSUPPORTED_PROMISE_PATTERNS.some((pattern) => pattern.test(reply));
}

export function detectUnbackedWorkClaim(reply: string): boolean {
  return UNBACKED_WORK_CLAIM_PATTERNS.some((pattern) => pattern.test(reply));
}

export const MAX_ACTIVE_DASHBOARDS = 5;
export const DASHBOARD_RESULT_CAPABILITIES: readonly DepartmentWorkCapability[] = [
  "crm.contacts.list",
  "crm.contacts.summary",
  "crm.segments.list",
  "crm.campaigns.list",
];

/** Mapping from a "results.publish" intent to the capability needed. */
export const PROMISE_TO_CAPABILITY: Readonly<
  Record<string, DepartmentWorkCapability>
> = {
  informe: "results.publish",
  reporte: "results.publish",
  resultados: "results.publish",
  contacts_analysis: "crm.contacts.summary",
  contacts_list: "crm.contacts.list",
  segment_list: "crm.segments.list",
  campaign_list: "crm.campaigns.list",
};

/* ----------------------------------------------------------------------------
 * DepartmentTask — durable work item.
 * --------------------------------------------------------------------------*/

export interface DepartmentTask {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly objectiveId: string | null;
  readonly requestedBy: string;
  /** Canonical Marketing specialist actually assigned to this work item. */
  readonly assignedEmployeeId?: string | null;
  readonly title: string;
  readonly summary: string;
  /** Required capability that fulfils this task. */
  readonly capability: DepartmentWorkCapability;
  /** Tool id that actually runs. */
  readonly toolId: string;
  readonly status: DepartmentWorkStatus;
  /** Human-language progress message ("Analizando 2.260 contactos…"). */
  readonly statusMessage: string;
  /** 0..1 progress fraction. */
  readonly progress: number;
  /** Required capabilities for this task to start. */
  readonly requiredCapabilities: readonly DepartmentWorkCapability[];
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly resultId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /** Wall-clock deadline. Tasks that exceed it are auto-failed. */
  readonly timeoutMs: number;
  /** Optional provenance for work created from a normalized Inbox item. */
  readonly source?: {
    readonly type: "inbox_email";
    readonly inboxItemId: string;
    readonly provider: string;
    readonly providerMessageId: string;
  } | {
    readonly type: "chat_operation";
    readonly operationKey: string;
  };
}

/* ----------------------------------------------------------------------------
 * DepartmentResult — durable artefact.
 * --------------------------------------------------------------------------*/

export type ChartKind = "bar" | "line" | "donut" | "number" | "table";

export interface ChartSeries {
  readonly name: string;
  readonly values: readonly number[];
  readonly labels?: readonly string[];
}

export interface ChartData {
  readonly kind: ChartKind;
  readonly title: string;
  readonly unit?: string;
  readonly series: readonly ChartSeries[];
  /** Optional structured rows for tables. */
  readonly rows?: readonly { readonly label: string; readonly value: string | number }[];
}

export interface DepartmentResult {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly relatedWorkItemId: string | null;
  readonly title: string;
  readonly summary: string;
  /** Markdown body — rendered through the portal Markdown renderer. */
  readonly content: string;
  /** Structured payload — queryable from the portal. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Chart payload — when the result includes a visualization. */
  readonly chart?: ChartData;
  readonly source: string;
  readonly createdAt: string;
  /** Capability that produced this result. */
  readonly producedByCapability: DepartmentWorkCapability;
}

/** Inputs to createResult — data is required if the caller provides one. */
export interface CreateDepartmentResultInput {
  readonly organizationId: string;
  readonly departmentId: string;
  readonly relatedWorkItemId: string | null;
  readonly title: string;
  readonly summary: string;
  readonly content: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly chart?: ChartData;
  readonly source: string;
  readonly producedByCapability: DepartmentWorkCapability;
}

/* ----------------------------------------------------------------------------
 * Persistence port — same shape for in-memory and Supabase adapters.
 * --------------------------------------------------------------------------*/

export interface DepartmentWorkStore {
  createTask(input: Omit<DepartmentTask, "id" | "createdAt">): Promise<DepartmentTask>;
  updateTask(id: string, patch: Partial<DepartmentTask>): Promise<DepartmentTask>;
  getTask(id: string): Promise<DepartmentTask | null>;
  findTaskBySource(organizationId: string, inboxItemId: string): Promise<DepartmentTask | null>;
  listTasksForOrg(organizationId: string, limit?: number): Promise<DepartmentTask[]>;
  createResult(input: CreateDepartmentResultInput): Promise<DepartmentResult>;
  getResult(id: string): Promise<DepartmentResult | null>;
  listResultsForOrg(organizationId: string, limit?: number): Promise<DepartmentResult[]>;
  countDashboardsForOrg(organizationId: string): Promise<number>;
  /** On process boot, close tasks whose durable deadline elapsed while the
   * in-process executor was unavailable. This makes restart state honest. */
  recoverExpiredTasks(now?: Date): Promise<number>;
  /** New tasks / status changes since a given iso timestamp. */
  feedSince(organizationId: string, since: string): Promise<{
    tasks: readonly DepartmentTask[];
    results: readonly DepartmentResult[];
    serverTime: string;
  }>;
}

/* ----------------------------------------------------------------------------
 * In-memory implementation.
 * --------------------------------------------------------------------------*/

export class InMemoryDepartmentWorkStore implements DepartmentWorkStore {
  private readonly tasks = new Map<string, DepartmentTask>();
  private readonly results = new Map<string, DepartmentResult>();
  private readonly updatedAt = new Map<string, string>();

  private genId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  async createTask(input: Omit<DepartmentTask, "id" | "createdAt">): Promise<DepartmentTask> {
    const task: DepartmentTask = {
      ...input,
      id: this.genId("task"),
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    this.updatedAt.set(`task:${task.id}`, task.createdAt);
    return task;
  }

  async updateTask(id: string, patch: Partial<DepartmentTask>): Promise<DepartmentTask> {
    const existing = this.tasks.get(id);
    if (!existing) throw new Error(`DepartmentTask ${id} not found`);
    const updated: DepartmentTask = { ...existing, ...patch };
    this.tasks.set(id, updated);
    this.updatedAt.set(`task:${id}`, new Date().toISOString());
    return updated;
  }

  async getTask(id: string): Promise<DepartmentTask | null> {
    return this.tasks.get(id) ?? null;
  }

  async findTaskBySource(organizationId: string, inboxItemId: string): Promise<DepartmentTask | null> {
    return [...this.tasks.values()].find((task) =>
      task.organizationId === organizationId &&
      task.source?.type === "inbox_email" &&
      task.source.inboxItemId === inboxItemId,
    ) ?? null;
  }

  async listTasksForOrg(organizationId: string, limit = 50): Promise<DepartmentTask[]> {
    return [...this.tasks.values()]
      .filter((t) => t.organizationId === organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async createResult(input: CreateDepartmentResultInput): Promise<DepartmentResult> {
    const result: DepartmentResult = {
      ...input,
      id: this.genId("res"),
      createdAt: new Date().toISOString(),
    };
    this.results.set(result.id, result);
    this.updatedAt.set(`result:${result.id}`, result.createdAt);
    return result;
  }

  async getResult(id: string): Promise<DepartmentResult | null> {
    return this.results.get(id) ?? null;
  }

  async listResultsForOrg(organizationId: string, limit = 50): Promise<DepartmentResult[]> {
    return [...this.results.values()]
      .filter((r) => r.organizationId === organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async countDashboardsForOrg(organizationId: string): Promise<number> {
    return [...this.results.values()].filter(
      (result) => result.organizationId === organizationId && result.chart !== undefined,
    ).length;
  }

  async recoverExpiredTasks(now = new Date()): Promise<number> {
    let recovered = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== "running" && task.status !== "queued") continue;
      const start = new Date(task.startedAt ?? task.createdAt).getTime();
      if (now.getTime() - start <= task.timeoutMs) continue;
      const message = "La tarea expiró mientras el runtime estaba reiniciándose.";
      this.tasks.set(task.id, {
        ...task,
        status: "failed",
        statusMessage: message,
        completedAt: now.toISOString(),
        errorCode: "TASK_TIMEOUT",
        errorMessage: message,
      });
      this.updatedAt.set(`task:${task.id}`, now.toISOString());
      recovered += 1;
    }
    return recovered;
  }

  async feedSince(organizationId: string, since: string): Promise<{
    tasks: readonly DepartmentTask[];
    results: readonly DepartmentResult[];
    serverTime: string;
  }> {
    const tasks = [...this.tasks.values()].filter(
      (t) => t.organizationId === organizationId && t.createdAt > since,
    );
    const results = [...this.results.values()].filter(
      (r) => r.organizationId === organizationId && r.createdAt > since,
    );
    return { tasks, results, serverTime: new Date().toISOString() };
  }
}

/* ----------------------------------------------------------------------------
 * Time-out enforcement — surfaces stuck tasks as failed/needs_attention.
 * --------------------------------------------------------------------------*/

export interface TimeoutCheck {
  readonly taskId: string;
  readonly status: "expired" | "ok";
  readonly statusMessage: string;
  readonly elapsedMs: number;
}

/** Pure function. Returns one entry per running/queued task. */
export function checkTaskTimeouts(
  tasks: readonly DepartmentTask[],
  now: Date = new Date(),
): TimeoutCheck[] {
  const out: TimeoutCheck[] = [];
  for (const task of tasks) {
    if (task.status !== "running" && task.status !== "queued") continue;
    const start = task.startedAt ?? task.createdAt;
    const elapsedMs = now.getTime() - new Date(start).getTime();
    if (elapsedMs > task.timeoutMs) {
      out.push({
        taskId: task.id,
        status: "expired",
        statusMessage: "La tarea ha superado el tiempo máximo de espera.",
        elapsedMs,
      });
    } else {
      out.push({ taskId: task.id, status: "ok", statusMessage: task.statusMessage, elapsedMs });
    }
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * Promise-without-capability guard.
 * --------------------------------------------------------------------------*/

export interface PromiseGuardResult {
  readonly allowed: boolean;
  readonly blockedPhrases: readonly string[];
  readonly requiredCapabilities: readonly DepartmentWorkCapability[];
}

/** Returns the list of blocked phrases + the capabilities the model
 *  would need to honour them. The portal uses this to (a) detect
 *  promises the system cannot keep and (b) tell the user what the
 *  system CAN actually do instead. */
export function checkReplyForUnsupportedPromises(reply: string): PromiseGuardResult {
  const blockedPhrases: string[] = [];
  const requiredCapabilities: DepartmentWorkCapability[] = [];
  for (const pattern of UNSUPPORTED_PROMISE_PATTERNS) {
    const match = reply.match(pattern);
    if (match) {
      blockedPhrases.push(match[0]);
      // Map the promise to its capability. If the model promises
      // "lo dejo en Resultados" we mark results.publish as required.
      requiredCapabilities.push("results.publish");
    }
  }
  return {
    allowed: blockedPhrases.length === 0,
    blockedPhrases,
    requiredCapabilities: Array.from(new Set(requiredCapabilities)),
  };
}

/* ----------------------------------------------------------------------------
 * Status message copy.
 * --------------------------------------------------------------------------*/

export function departmentWorkStatusMessage(
  status: DepartmentWorkStatus,
  locale: SupportedLocale,
): string {
  const es = locale !== "en";
  switch (status) {
    case "queued":
      return es ? "En cola…" : "Queued…";
    case "running":
      return es ? "Elvira está trabajando…" : "Elvira is working…";
    case "waiting_approval":
      return es
        ? "Esperando tu aprobación para continuar."
        : "Waiting for your approval to continue.";
    case "completed":
      return es ? "Informe listo." : "Report ready.";
    case "failed":
      return es
        ? "No he podido completar este trabajo."
        : "I could not complete this work.";
    case "cancelled":
      return es ? "Trabajo cancelado." : "Work cancelled.";
  }
}

export function departmentWorkFailureMessage(
  task: DepartmentTask,
  locale: SupportedLocale,
): string {
  const es = locale !== "en";
  const base = es
    ? `No he podido completar ${task.summary}.`
    : `I could not complete ${task.summary}.`;
  if (task.errorCode === "dashboard_limit") {
    return es
      ? "Ya hay 5 dashboards activos. No he creado otro. Elimina uno o pide que se reutilice/actualice uno existente."
      : "There are already 5 active dashboards. I did not create another one. Delete one or reuse/update an existing dashboard.";
  }
  if (task.errorCode === "auth") {
    return es
      ? `${base} Las credenciales de Mautic han fallado. Te paso a Conexiones para revisarlo.`
      : `${base} Mautic credentials failed. I'll take you to Connections to review it.`;
  }
  if (task.errorCode === "unavailable") {
    return es
      ? `${base} Mautic no responde. Reintenta en unos minutos.`
      : `${base} Mautic is not responding. Try again in a few minutes.`;
  }
  if (task.errorCode === "drive_provider") {
    return es
      ? `${base} Google Drive no ha confirmado la operación. No se ha modificado nada fuera de Departify. Puedo intentarlo de nuevo.`
      : `${base} Google Drive did not confirm the operation. Nothing outside Departify was modified. I can try again.`;
  }
  if (task.errorCode === "generation_failed" || task.errorCode === "specialist_unavailable") {
    return es
      ? `${base} No he recibido una respuesta completa del plan. Puedes reintentarlo.`
      : `${base} I did not receive a complete response for the plan. You can retry it.`;
  }
  return base;
}

/**
 * DepartmentWorkExecutor — Customer Zero 01 P0.
 *
 * The orchestrator that closes the asynchronous loop:
 *
 *   1. Ensure required capabilities are available.
 *   2. Create a DepartmentTask (queued → running).
 *   3. Execute the capability.
 *   4. On success: create a DepartmentResult, mark the task
 *      completed, record an Activity entry, and emit the final
 *      ELVIRA message into the conversation automatically.
 *   5. On failure: mark the task failed/needs_attention, record
 *      the failure Activity, and emit the failure message.
 *
 * The executor is deterministic. No fake timers.
 */

import type { SupportedLocale } from "./locale.js";
import {
  isCapabilityAvailable,
  type BusinessCapability,
} from "./capability-registry.js";
import { resolveCredentials, getCredentials } from "./credential-resolver.js";
import {
  getMauticSummary,
  listMauticContacts,
  listMauticSegments,
  listMauticCampaigns,
  type MauticCredentials,
} from "./mautic-adapter.js";
import {
  InMemoryDepartmentWorkStore,
  MAX_ACTIVE_DASHBOARDS,
  DASHBOARD_RESULT_CAPABILITIES,
  type DepartmentTask,
  type DepartmentResult,
  type DepartmentWorkStore,
  type ChartData,
  type DepartmentWorkCapability,
  type CreateDepartmentResultInput,
  departmentWorkFailureMessage,
  departmentWorkStatusMessage,
} from "./department-work.js";
import type { DepartmentActivity } from "./marketing-domain.js";
import type { MarketingActivityRepository } from "./marketing-repositories.js";

/* ----------------------------------------------------------------------------
 * Inputs.
 * --------------------------------------------------------------------------*/

export interface ExecuteWorkInput {
  readonly organizationId: string;
  readonly conversationId: string;
  readonly departmentId: "marketing";
  readonly objectiveId: string | null;
  readonly requestedBy: string;
  /** Specialist selected by Elvira's plan; persisted for honest status. */
  readonly assignedEmployeeId?: string;
  readonly title: string;
  readonly summary: string;
  /** Capability the engine plan is invoking. */
  readonly capability: BusinessCapability;
  /** Optional bounded transformation composed from the source capability. */
  readonly transformation?: "score";
  readonly locale: SupportedLocale;
}

export interface ExecuteWorkOutput {
  readonly task: DepartmentTask;
  readonly result: DepartmentResult | null;
  /** Final assistant message to inject into the conversation. */
  readonly finalMessage: string;
  /** Activity entry to record. */
  readonly activity: DepartmentActivity;
  /** Used by the chat response so the portal can render the work
   *  state immediately. */
  readonly finalSpeaker: "departify" | "elvira";
}

export interface ExecuteWorkDeps {
  readonly workStore: DepartmentWorkStore;
  readonly activityRepo: MarketingActivityRepository;
  readonly onMessageInjected?: (input: {
    organizationId: string;
    conversationId: string;
    speaker: "elvira" | "departify";
    content: string;
    relatedTaskId: string;
    relatedResultId: string | null;
  }) => void | Promise<void>;
}

/* ----------------------------------------------------------------------------
 * Capability → executor mapping.
 * --------------------------------------------------------------------------*/

type Executor = (
  credentials: MauticCredentials,
  input: ExecuteWorkInput,
  signal: AbortSignal,
) => Promise<DepartmentResult>;

const CREDENTIALED_EXECUTORS: Readonly<
  Partial<Record<DepartmentWorkCapability, Executor>>
> = {
  "crm.contacts.summary": async (creds) => {
    const summary = await getMauticSummary(creds, new AbortController().signal, {
      inactivityThresholdDays: 60,
    });
    if (!summary.success || !summary.value) {
      throw new DepartmentWorkError(
        summary.errorCode ?? "invalid_response",
        summary.message ?? "Mautic summary failed",
      );
    }
    return buildContactsSummaryResult(summary.value);
  },
  "crm.contacts.list": async (creds, input) => {
    const page = await listMauticContacts(
      creds,
      { limit: input.transformation === "score" ? 200 : 50, orderBy: "dateAdded" },
      new AbortController().signal,
    );
    if (!page.success || !page.value) {
      throw new DepartmentWorkError(
        page.errorCode ?? "invalid_response",
        page.message ?? "Mautic contacts list failed",
      );
    }
    return input.transformation === "score"
      ? buildContactsScoringResult(page.value)
      : buildContactsListResult(page.value);
  },
  "crm.segments.list": async (creds) => {
    const segments = await listMauticSegments(creds, new AbortController().signal);
    if (!segments.success || !segments.value) {
      throw new DepartmentWorkError(
        segments.errorCode ?? "invalid_response",
        segments.message ?? "Mautic segments failed",
      );
    }
    return buildSegmentsResult(segments.value);
  },
  "crm.campaigns.list": async (creds) => {
    const campaigns = await listMauticCampaigns(creds, new AbortController().signal);
    if (!campaigns.success || !campaigns.value) {
      throw new DepartmentWorkError(
        campaigns.errorCode ?? "invalid_response",
        campaigns.message ?? "Mautic campaigns failed",
      );
    }
    return buildCampaignsResult(campaigns.value);
  },
};

export class DepartmentWorkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DepartmentWorkError";
  }
}

/* ----------------------------------------------------------------------------
 * Result builders — produce normalized DepartmentResult payloads.
 * --------------------------------------------------------------------------*/

function buildContactsSummaryResult(summary: {
  totalContacts: number;
  totalSegments: number;
  totalCampaigns: number;
  contactsWithoutRecentActivity?: number;
  topSegments?: readonly { id: number; name: string; count: number }[];
}): DepartmentResult {
  const stale = summary.contactsWithoutRecentActivity ?? 0;
  const total = summary.totalContacts;
  const stalePct = total > 0 ? Math.round((stale * 100) / total) : 0;

  const content = [
    `Total de contactos en Mautic: **${total}**.`,
    `Contactos sin actividad reciente (>60 días): **${stale}** (${stalePct}%).`,
    summary.topSegments && summary.topSegments.length > 0
      ? `Top segmentos: ${summary.topSegments
          .slice(0, 5)
          .map((s) => `${s.name} (${s.count})`)
          .join(", ")}.`
      : "Mautic no devolvió segmentos en este momento.",
    "",
    "Recomendación prioritaria: revisar el segmento de contactos sin actividad reciente antes de invertir en adquisición nueva.",
  ].join("\n");

  const chart: ChartData = {
    kind: "bar",
    title: "Resumen de contactos",
    unit: "contactos",
    series: [
      {
        name: "Contactos",
        labels: ["Activos", "Sin actividad reciente"],
        values: [Math.max(total - stale, 0), stale],
      },
    ],
  };

  return {
    id: "",
    organizationId: "",
    departmentId: "marketing",
    relatedWorkItemId: null,
    title: "Resumen de contactos de Mautic",
    summary: `${total} contactos en Mautic; ${stale} sin actividad reciente (>60 días).`,
    content,
    data: summary as unknown as Readonly<Record<string, unknown>>,
    chart,
    source: "Mautic",
    createdAt: "",
    producedByCapability: "crm.contacts.summary",
  };
}

function buildContactsListResult(page: {
  total: number;
  contacts: readonly {
    id: number;
    displayName: string;
    email?: string;
    company?: string;
    lastActivityAt?: string;
  }[];
}): DepartmentResult {
  const rows = page.contacts.slice(0, 20).map((c) => ({
    label: c.displayName,
    value: [c.email, c.company, c.lastActivityAt].filter(Boolean).join(" · "),
  }));
  const content = [
    `Listado de los primeros ${rows.length} contactos de ${page.total} en Mautic.`,
    "",
    ...rows.map((r) => `- **${r.label}** — ${r.value || "sin datos adicionales"}`),
  ].join("\n");

  return {
    id: "",
    organizationId: "",
    departmentId: "marketing",
    relatedWorkItemId: null,
    title: `Listado de contactos Mautic (${page.total})`,
    summary: `${page.total} contactos en Mautic. Mostrando los primeros ${rows.length}.`,
    content,
    data: { total: page.total, sampleSize: rows.length },
    chart: {
      kind: "table",
      title: "Contactos",
      series: [{ name: "Contactos", values: [], labels: [] }],
      rows,
    },
    source: "Mautic",
    createdAt: "",
    producedByCapability: "crm.contacts.list",
  };
}

function buildContactsScoringResult(page: {
  total: number;
  contacts: readonly {
    id: number;
    displayName: string;
    score?: number;
  }[];
}): DepartmentResult {
  const scored = page.contacts.filter(
    (contact): contact is typeof contact & { score: number } =>
      typeof contact.score === "number" && Number.isFinite(contact.score),
  );
  if (scored.length === 0) {
    throw new DepartmentWorkError(
      "unsupported",
      "Mautic no ha proporcionado puntuaciones de contactos para generar este resultado.",
    );
  }

  const ordered = [...scored].sort((left, right) => right.score - left.score);
  const bands = [
    { label: "0–24", min: 0, max: 24 },
    { label: "25–49", min: 25, max: 49 },
    { label: "50–74", min: 50, max: 74 },
    { label: "75+", min: 75, max: Number.POSITIVE_INFINITY },
  ];
  const values = bands.map((band) =>
    scored.filter((contact) => contact.score >= band.min && contact.score <= band.max).length,
  );
  const rows = ordered.slice(0, 20).map((contact) => ({
    label: contact.displayName,
    value: String(contact.score),
  }));
  const average = Math.round(
    scored.reduce((sum, contact) => sum + contact.score, 0) / scored.length,
  );
  const content = [
    `Scoring calculado sobre ${scored.length} contactos puntuados de ${page.total}.`,
    `Puntuación media: **${average}**.`,
    "",
    "Contactos con mayor puntuación:",
    ...rows.map((row) => `- **${row.label}** — ${row.value}`),
  ].join("\n");

  return {
    id: "",
    organizationId: "",
    departmentId: "marketing",
    relatedWorkItemId: null,
    title: "Scoring de contactos",
    summary: `He preparado el scoring de ${scored.length} contactos con una puntuación media de ${average}.`,
    content,
    data: {
      totalContacts: page.total,
      scoredContacts: scored.length,
      averageScore: average,
      topContacts: ordered.slice(0, 20).map((contact) => ({
        id: contact.id,
        name: contact.displayName,
        score: contact.score,
      })),
    },
    chart: {
      kind: "bar",
      title: "Distribución del scoring",
      unit: "contactos",
      series: [{
        name: "Contactos",
        labels: bands.map((band) => band.label),
        values,
      }],
      rows,
    },
    source: "CRM",
    createdAt: "",
    producedByCapability: "crm.contacts.list",
  };
}

function buildSegmentsResult(segments: readonly {
  id: number;
  name: string;
  contactCount?: number;
}[]): DepartmentResult {
  const rows = segments.slice(0, 20).map((s) => ({
    label: s.name,
    value: s.contactCount !== undefined ? `${s.contactCount} contactos` : "—",
  }));
  const content = [
    `${segments.length} segmentos en Mautic.`,
    "",
    ...rows.map((r) => `- **${r.label}** — ${r.value}`),
  ].join("\n");
  return {
    id: "",
    organizationId: "",
    departmentId: "marketing",
    relatedWorkItemId: null,
    title: `Segmentos Mautic (${segments.length})`,
    summary: `${segments.length} segmentos activos.`,
    content,
    data: { count: segments.length },
    chart: {
      kind: "bar",
      title: "Contactos por segmento",
      unit: "contactos",
      series: [
        {
          name: "Contactos",
          labels: segments.slice(0, 10).map((s) => s.name),
          values: segments.slice(0, 10).map((s) => s.contactCount ?? 0),
        },
      ],
    },
    source: "Mautic",
    createdAt: "",
    producedByCapability: "crm.segments.list",
  };
}

function buildCampaignsResult(campaigns: readonly {
  id: number;
  name: string;
  status?: string;
  isPublished?: boolean;
}[]): DepartmentResult {
  const rows = campaigns.slice(0, 20).map((c) => ({
    label: c.name,
    value: c.status ?? (c.isPublished ? "publicada" : "no publicada"),
  }));
  const content = [
    `${campaigns.length} campañas en Mautic.`,
    "",
    ...rows.map((r) => `- **${r.label}** — ${r.value}`),
  ].join("\n");
  return {
    id: "",
    organizationId: "",
    departmentId: "marketing",
    relatedWorkItemId: null,
    title: `Campañas Mautic (${campaigns.length})`,
    summary: `${campaigns.length} campañas activas.`,
    content,
    data: { count: campaigns.length },
    chart: {
      kind: "table",
      title: "Campañas",
      series: [{ name: "Campañas", values: [], labels: [] }],
      rows,
    },
    source: "Mautic",
    createdAt: "",
    producedByCapability: "crm.campaigns.list",
  };
}

/* ----------------------------------------------------------------------------
 * The executor itself.
 * --------------------------------------------------------------------------*/

export class DepartmentWorkExecutor {
  constructor(private readonly deps: ExecuteWorkDeps) {}

  /**
   * Run the executor for an explicit capability. Returns the durable
   * task, optional result, the final assistant message, and an
   * activity entry. Caller persists the assistant message into the
   * conversation store.
   */
  async run(input: ExecuteWorkInput): Promise<ExecuteWorkOutput> {
    // Dashboard capacity is a control-plane invariant. Check it before
    // resolving credentials or invoking any provider so a sixth dashboard is
    // never started or implied by the model.
    if (
      DASHBOARD_RESULT_CAPABILITIES.includes(input.capability as DepartmentWorkCapability) &&
      await this.deps.workStore.countDashboardsForOrg(input.organizationId) >= MAX_ACTIVE_DASHBOARDS
    ) {
      return this.fail(input, "dashboard_limit", "The organization already has the maximum number of active dashboards.");
    }

    // 1. Capability gating — refuse to run if the capability is not
    //    available for the org. This is what makes
    //    "promise-without-capability" structurally impossible.
    const availability = isCapabilityAvailable(
      input.organizationId,
      input.capability,
    );
    if (!availability.available) {
      return this.fail(input, "unavailable", "La capacidad no está disponible todavía.");
    }

    // 2. Resolve credentials.
    const resolution = resolveCredentials({
      organizationId: input.organizationId,
      provider: "mautic",
    });
    if (!resolution.available || !resolution.handle) {
      return this.fail(input, "missing", "Las credenciales de Mautic no están configuradas.");
    }
    const creds = getCredentials(resolution.handle);
    if (!creds) {
      return this.fail(input, "missing", "No se pudieron cargar las credenciales.");
    }

    // 3. Create the durable task — queued → running.
    const capability = input.capability as DepartmentWorkCapability;
    const task = await this.deps.workStore.createTask({
      organizationId: input.organizationId,
      departmentId: input.departmentId,
      objectiveId: input.objectiveId,
      requestedBy: input.requestedBy,
      assignedEmployeeId: input.assignedEmployeeId ?? specialistForCapability(capability),
      title: input.title,
      summary: input.summary,
      capability,
      toolId: mapCapabilityToToolId(capability),
      status: "running",
      statusMessage: departmentWorkStatusMessage("running", input.locale),
      progress: 0.05,
      requiredCapabilities: [capability],
      startedAt: new Date().toISOString(),
      completedAt: null,
      resultId: null,
      errorCode: null,
      errorMessage: null,
      timeoutMs: 60_000,
    });

    // 4. Execute the capability.
    const executor = CREDENTIALED_EXECUTORS[capability];
    if (!executor) {
      return this.failTask(
        task,
        input,
        "unavailable",
        `La capacidad ${capability} aún no tiene un ejecutor cableado.`,
      );
    }
    if (!creds || creds.provider !== "mautic") {
      return this.failTask(
        task,
        input,
        "missing_credentials",
        `Mautic no está conectado para esta capacidad.`,
      );
    }
    const mauticCreds = creds;

    try {
      const builtResult = await executor(mauticCreds, input, new AbortController().signal);
      // 5. Persist the result + mark the task completed + record activity.
      const resultInput: CreateDepartmentResultInput = {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        relatedWorkItemId: task.id,
        title: builtResult.title,
        summary: builtResult.summary,
        content: builtResult.content,
        source: builtResult.source,
        producedByCapability: capability,
      };
      if (builtResult.data !== undefined) {
        (resultInput as { data?: Readonly<Record<string, unknown>> }).data = builtResult.data;
      }
      if (builtResult.chart !== undefined) {
        (resultInput as { chart?: ChartData }).chart = builtResult.chart;
      }
      const result = await this.deps.workStore.createResult(resultInput);
      const completedTask = await this.deps.workStore.updateTask(task.id, {
        status: "completed",
        progress: 1,
        statusMessage: departmentWorkStatusMessage("completed", input.locale),
        completedAt: new Date().toISOString(),
        resultId: result.id,
      });
      const finalMessage = `${builtResult.summary}\n\n${builtResult.content}`;
      const activity = await this.deps.activityRepo.create({
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
        actor: "Elvira",
        type: "resultado_generado",
        message: `Elvira publicó: ${builtResult.title}`,
      });
      if (this.deps.onMessageInjected) {
        await this.deps.onMessageInjected({
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          speaker: "elvira",
          content: finalMessage,
          relatedTaskId: completedTask.id,
          relatedResultId: result.id,
        });
      }
      return {
        task: completedTask,
        result,
        finalMessage,
        activity,
        finalSpeaker: "elvira",
      };
    } catch (cause) {
      const code = cause instanceof DepartmentWorkError ? cause.code : "unavailable";
      const message = cause instanceof Error ? cause.message : "Error desconocido";
      return this.failTask(task, input, code, message);
    }
  }

  private async fail(
    input: ExecuteWorkInput,
    code: string,
    message: string,
  ): Promise<ExecuteWorkOutput> {
    const task = await this.deps.workStore.createTask({
      organizationId: input.organizationId,
      departmentId: input.departmentId,
      objectiveId: input.objectiveId,
      requestedBy: input.requestedBy,
      title: input.title,
      summary: input.summary,
      capability: input.capability as DepartmentWorkCapability,
      toolId: mapCapabilityToToolId(input.capability as DepartmentWorkCapability),
      status: "failed",
      statusMessage: departmentWorkStatusMessage("failed", input.locale),
      progress: 0,
      requiredCapabilities: [input.capability as DepartmentWorkCapability],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      resultId: null,
      errorCode: code,
      errorMessage: message,
      timeoutMs: 60_000,
    });
    const finalMessage = departmentWorkFailureMessage(task, input.locale);
    const activity = await this.deps.activityRepo.create({
      organizationId: input.organizationId,
      departmentId: input.departmentId,
      ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
      actor: "Elvira",
      type: "analisis_realizado",
      message: `Elvira no pudo completar: ${input.title}.`,
    });
    if (this.deps.onMessageInjected) {
      await this.deps.onMessageInjected({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        speaker: "elvira",
        content: finalMessage,
        relatedTaskId: task.id,
        relatedResultId: null,
      });
    }
    return {
      task,
      result: null,
      finalMessage,
      activity,
      finalSpeaker: "elvira",
    };
  }

  private async failTask(
    task: DepartmentTask,
    input: ExecuteWorkInput,
    code: string,
    message: string,
  ): Promise<ExecuteWorkOutput> {
    const updated = await this.deps.workStore.updateTask(task.id, {
      status: "failed",
      progress: 0,
      statusMessage: departmentWorkStatusMessage("failed", input.locale),
      completedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage: message,
    });
    const finalMessage = departmentWorkFailureMessage(updated, input.locale);
    const activity = await this.deps.activityRepo.create({
      organizationId: input.organizationId,
      departmentId: input.departmentId,
      ...(input.objectiveId ? { objectiveId: input.objectiveId } : {}),
      actor: "Elvira",
      type: "analisis_realizado",
      message: `Elvira no pudo completar: ${updated.title}.`,
    });
    if (this.deps.onMessageInjected) {
      await this.deps.onMessageInjected({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        speaker: "elvira",
        content: finalMessage,
        relatedTaskId: updated.id,
        relatedResultId: null,
      });
    }
    return {
      task: updated,
      result: null,
      finalMessage,
      activity,
      finalSpeaker: "elvira",
    };
  }
}

function specialistForCapability(capability: BusinessCapability): string {
  if (capability.startsWith("crm.")) return "agent_content_strategist";
  if (capability.startsWith("email.")) return "agent_social_media_manager";
  return "agent_ads_specialist";
}

/* ----------------------------------------------------------------------------
 * Helpers.
 * --------------------------------------------------------------------------*/

function mapCapabilityToToolId(capability: DepartmentWorkCapability): string {
  switch (capability) {
    case "crm.contacts.summary":
      return "mautic.contacts.summary";
    case "crm.contacts.list":
      return "mautic.contacts.list";
    case "crm.segments.list":
      return "mautic.segments.list";
    case "crm.campaigns.list":
      return "mautic.campaigns.list";
    case "results.publish":
      return "department.work.publish_result";
    case "memory.remember":
      return "department.work.remember";
  }
}

/** Default executor used by the backend wiring. */
export function createDefaultDepartmentWorkExecutor(
  activityRepo: MarketingActivityRepository,
  workStore?: DepartmentWorkStore,
  onMessageInjected?: ExecuteWorkDeps["onMessageInjected"],
): DepartmentWorkExecutor {
  return new DepartmentWorkExecutor({
    workStore: workStore ?? new InMemoryDepartmentWorkStore(),
    activityRepo,
    ...(onMessageInjected ? { onMessageInjected } : {}),
  });
}

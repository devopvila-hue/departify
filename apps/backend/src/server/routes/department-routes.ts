import type { FastifyInstance } from "fastify";
import {
  DashboardLimitError,
  InMemoryDepartmentDashboardStore,
  MAX_ACTIVE_DASHBOARDS,
  type DashboardDateRange,
  type DashboardWidget,
  type DashboardWidgetKind,
  type DepartmentDashboardStore,
} from "../../customer-zero/department-dashboards.js";
import {
  filterBusinessCalendar,
  projectBusinessCalendar,
  type BusinessCalendarStatus,
  type BusinessCalendarType,
} from "../../customer-zero/department-calendar.js";
import { auditWebsite } from "../../customer-zero/seo-audit.js";
import { requireSession, workStoreForRoutes } from "./customer-zero-v2.js";
import { buildCanonicalConnectionViews } from "./customer-zero-v2.js";
import { findOperationalGoogleIdentityForOrg } from "../../customer-zero/credential-resolver.js";
import { GoogleCalendarAdapter } from "../../customer-zero/google-calendar-adapter.js";
import type { ServerDeps } from "../deps.js";
import type { DepartmentWorkCapability } from "../../customer-zero/department-work.js";
import {
  getSeoRepositoryLinkStore,
  inspectGithubRepository,
  listGithubRepositories,
} from "../../customer-zero/seo-repository.js";
import { projectDepartmentCapabilities } from "../../customer-zero/department-capabilities.js";
import { buildSeoOnboardingState } from "../../customer-zero/seo-onboarding.js";

const WIDGET_KINDS = new Set<DashboardWidgetKind>([
  "metric", "line", "bar", "area", "donut", "table", "timeline", "calendar-summary",
]);

let dashboardStoreSingleton: DepartmentDashboardStore | null = null;
function dashboardStoreForRoutes(deps: ServerDeps): DepartmentDashboardStore {
  dashboardStoreSingleton ??= deps.dashboardStore ?? new InMemoryDepartmentDashboardStore();
  return dashboardStoreSingleton;
}

function defaultDashboard(departmentId: string): {
  title: string;
  description: string;
  dateRange: DashboardDateRange;
  metrics: readonly string[];
  widgets: readonly DashboardWidget[];
  filters: readonly string[];
  dataSources: readonly string[];
  layout: Readonly<Record<string, unknown>>;
} {
  if (departmentId === "seo") {
    return {
      title: "SEO Overview",
      description: "Problemas verificables, progreso y rendimiento disponible.",
      dateRange: { kind: "relative", days: 30 },
      metrics: ["issues_critical", "issues_important", "opportunities"],
      widgets: [
        { id: "seo-health", kind: "metric", title: "Estado de la web", source: "seo.audit" },
        { id: "seo-issues", kind: "table", title: "Problemas SEO", source: "seo.audit" },
        { id: "seo-progress", kind: "timeline", title: "Trabajo SEO", source: "seo.work" },
      ],
      filters: ["priority", "status"],
      dataSources: ["company.website", "department_tasks", "department_results"],
      layout: { columns: 2 },
    };
  }
  return {
    title: "Próximos 21 días",
    description: "Una vista operativa de lo que Marketing tiene por delante.",
    dateRange: { kind: "relative", days: 21 },
    metrics: ["scheduled_publications", "pending_approval", "completed_results"],
    widgets: [
      { id: "marketing-kpis", kind: "metric", title: "Resumen de Marketing", source: "marketing.work" },
      { id: "marketing-timeline", kind: "timeline", title: "Trabajo y publicaciones", source: "marketing.work" },
      { id: "marketing-table", kind: "table", title: "Próximas acciones", source: "marketing.work" },
      { id: "marketing-calendar", kind: "calendar-summary", title: "Calendario de Marketing", source: "departify.calendar" },
    ],
    filters: ["status", "channel"],
    dataSources: ["department_tasks", "department_results", "marketing_approvals"],
    layout: { columns: 2 },
  };
}

function readDashboardInput(body: unknown, departmentId: string, createdBy?: string) {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const template = input.template === "seo" || input.template === "marketing" ? input.template : departmentId;
  const defaults = defaultDashboard(template === "seo" ? "seo" : departmentId);
  const widgets = Array.isArray(input.widgets) ? input.widgets : defaults.widgets;
  if (!widgets.every((widget) => {
    if (!widget || typeof widget !== "object") return false;
    const candidate = widget as Record<string, unknown>;
    return typeof candidate.id === "string" && typeof candidate.kind === "string" && WIDGET_KINDS.has(candidate.kind as DashboardWidgetKind) && typeof candidate.title === "string" && typeof candidate.source === "string";
  })) throw new Error("Los widgets del dashboard no son válidos.");
  return {
    organizationId: "",
    departmentId,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : defaults.title,
    description: typeof input.description === "string" ? input.description.trim() : defaults.description,
    dateRange: (input.dateRange && typeof input.dateRange === "object" ? input.dateRange : defaults.dateRange) as DashboardDateRange,
    metrics: Array.isArray(input.metrics) ? input.metrics.filter((value): value is string => typeof value === "string") : defaults.metrics,
    widgets: widgets as DashboardWidget[],
    filters: Array.isArray(input.filters) ? input.filters.filter((value): value is string => typeof value === "string") : defaults.filters,
    dataSources: defaults.dataSources,
    layout: defaults.layout,
    ...(createdBy ? { createdBy } : {}),
  };
}

async function getCalendarEntries(organizationId: string, deps: ServerDeps, request: { authUser?: { id: string } }) {
  const store = workStoreForRoutes();
  const [tasks, results] = await Promise.all([
    store.listTasksForOrg(organizationId, 200),
    store.listResultsForOrg(organizationId, 200),
  ]);
  const approvals = deps.marketing ? await deps.marketing.listApprovals(organizationId) : [];
  let externalEvents: Awaited<ReturnType<GoogleCalendarAdapter["listEvents"]>>["value"] = [];
  let externalState: "connected" | "disconnected" | "error" = "disconnected";
  try {
    const identity = await findOperationalGoogleIdentityForOrg(organizationId, "calendar.read", request.authUser?.id);
    if (identity) {
      const result = await new GoogleCalendarAdapter({ organizationId, userId: identity.userId }).listEvents({
        timeMinIso: new Date(Date.now() - 86_400_000).toISOString(),
        timeMaxIso: new Date(Date.now() + 31 * 86_400_000).toISOString(),
        maxResults: 100,
      });
      if (result.success) {
        externalEvents = result.value ?? [];
        externalState = "connected";
      } else externalState = "error";
    }
  } catch {
    externalState = "error";
  }
  return {
    entries: projectBusinessCalendar({ organizationId, tasks, results, approvals, externalEvents }),
    externalState,
  };
}

export async function registerDepartmentRoutes(server: FastifyInstance, deps: ServerDeps = {}): Promise<void> {
  dashboardStoreSingleton = deps.dashboardStore ?? new InMemoryDepartmentDashboardStore();
  server.get<{ Params: { organizationId: string } }>("/api/dashboards/:organizationId", async (request) => {
    const { organizationId } = request.params;
    await requireSession(organizationId, deps);
    const store = dashboardStoreForRoutes(deps);
    const dashboards = await store.listForOrg(organizationId);
    const dashboardCount = await store.countActive(organizationId);
    return { organizationId, dashboards, dashboardCount, dashboardLimit: MAX_ACTIVE_DASHBOARDS, remainingSlots: Math.max(0, MAX_ACTIVE_DASHBOARDS - dashboardCount) };
  });

  server.get<{ Params: { organizationId: string; departmentId: string } }>("/api/departments/:departmentId/:organizationId/dashboards", async (request) => {
    const { organizationId, departmentId } = request.params;
    await requireSession(organizationId, deps);
    const store = dashboardStoreForRoutes(deps);
    const dashboards = await store.listForOrg(organizationId, departmentId);
    const count = await store.countActive(organizationId);
    return { organizationId, departmentId, dashboards, dashboardCount: count, dashboardLimit: MAX_ACTIVE_DASHBOARDS, remainingSlots: Math.max(0, MAX_ACTIVE_DASHBOARDS - count) };
  });

  server.post<{ Params: { organizationId: string; departmentId: string }; Body: unknown }>("/api/departments/:departmentId/:organizationId/dashboards", async (request, reply) => {
    const { organizationId, departmentId } = request.params;
    await requireSession(organizationId, deps);
    try {
      const input = readDashboardInput(request.body, departmentId, request.authUser?.id);
      const dashboard = await dashboardStoreForRoutes(deps).create({ ...input, organizationId });
      return reply.code(201).send({ organizationId, dashboard, dashboardCount: await dashboardStoreForRoutes(deps).countActive(organizationId), dashboardLimit: MAX_ACTIVE_DASHBOARDS });
    } catch (error) {
      if (error instanceof DashboardLimitError || (error instanceof Error && /dashboard_limit|5 dashboards/i.test(error.message))) {
        return reply.code(409).send({ error: { code: "DASHBOARD_LIMIT", message: "Ya hay 5 dashboards activos. Elimina uno o reutiliza uno existente." } });
      }
      if (error instanceof Error && /widgets|dashboard no son válidos/i.test(error.message)) {
        return reply.code(400).send({ error: { code: "INVALID_DASHBOARD", message: error.message } });
      }
      throw error;
    }
  });

  server.delete<{ Params: { organizationId: string; departmentId: string; dashboardId: string } }>("/api/departments/:departmentId/:organizationId/dashboards/:dashboardId", async (request, reply) => {
    const { organizationId, dashboardId } = request.params;
    await requireSession(organizationId, deps);
    const dashboard = await dashboardStoreForRoutes(deps).archive(organizationId, dashboardId);
    if (!dashboard) return reply.code(404).send({ error: { code: "DASHBOARD_NOT_FOUND", message: "No hemos encontrado ese dashboard." } });
    return { organizationId, dashboard };
  });

  server.get<{ Params: { organizationId: string }; Querystring: { departmentId?: string; type?: BusinessCalendarType; status?: BusinessCalendarStatus; from?: string; to?: string } }>("/api/calendar/:organizationId", async (request) => {
    const { organizationId } = request.params;
    await requireSession(organizationId, deps);
    const projected = await getCalendarEntries(organizationId, deps, request);
    const entries = filterBusinessCalendar(projected.entries, request.query);
    return { organizationId, entries, externalState: projected.externalState, sourceCount: entries.length };
  });

  server.get<{ Params: { organizationId: string } }>("/api/departments/seo/:organizationId", async (request) => {
    const { organizationId } = request.params;
    const session = await requireSession(organizationId, deps);
    const [dna, tasks, results, connections] = await Promise.all([
      deps.companyDna?.get(organizationId) ?? Promise.resolve(null),
      workStoreForRoutes().listTasksForOrg(organizationId, 100),
      workStoreForRoutes().listResultsForOrg(organizationId, 100),
      buildCanonicalConnectionViews(session, session.state.locale),
    ]);
    const seoTasks = tasks.filter((task) => task.departmentId === "seo");
    const seoResults = results.filter((result) => result.departmentId === "seo");
    const repository = dna?.website
      ? await getSeoRepositoryLinkStore().get(organizationId, dna.website)
      : null;
    const repositoryConnected = connections.some(
      (connection) => connection.toolId === "github_repository" && connection.state === "connected",
    );
    const capabilities = projectDepartmentCapabilities("seo", connections).map((capability) =>
      !dna?.website && capability.id !== "seo.search-console" && capability.id !== "seo.analytics"
        ? { ...capability, state: "necesita_conexion" as const }
        : capability,
    );
    const onboarding = buildSeoOnboardingState({ website: dna?.website, repository, repositoryConnected });
    return {
      organizationId,
      department: { id: "seo", name: "SEO", responsible: "Responsable de SEO", description: "Mejora verificable de la web y su visibilidad orgánica." },
      state: dna?.website ? repository ? "ready" : "web_detected" : "disconnected",
      website: dna?.website ?? null,
      onboarding,
      repository,
      repositories: repositoryConnected && !repository
        ? await listGithubRepositories(organizationId, request.authUser?.id ?? organizationId)
        : [],
      tasks: seoTasks,
      results: seoResults,
      capabilities: {
        websiteAudit: Boolean(dna?.website),
        searchConsole: capabilities.some((capability) => capability.id === "seo.search-console" && capability.state === "disponible"),
        analytics: capabilities.some((capability) => capability.id === "seo.analytics" && capability.state === "disponible"),
        repositoryRead: Boolean(repository && repositoryConnected),
        repositoryWrite: false,
        roster: capabilities,
      },
    };
  });

  server.post<{
    Params: { organizationId: string };
    Body: { repositoryId?: string; repositoryFullName?: string; defaultBranch?: string };
  }>("/api/departments/seo/:organizationId/repository", async (request, reply) => {
    const { organizationId } = request.params;
    const session = await requireSession(organizationId, deps);
    const dna = await (deps.companyDna?.get(organizationId) ?? Promise.resolve(null));
    if (!dna?.website) return reply.code(409).send({ error: { code: "SEO_WEBSITE_REQUIRED", message: "Primero necesitamos detectar la web de tu empresa." } });
    const userId = request.authUser?.id ?? organizationId;
    const connections = await buildCanonicalConnectionViews(session, session.state.locale);
    if (!connections.some((connection) => connection.toolId === "github_repository" && connection.state === "connected")) {
      return reply.code(409).send({ error: { code: "SEO_REPOSITORY_CONNECTION_REQUIRED", message: "Conecta el proyecto de tu web antes de seleccionar un repositorio." } });
    }
    const body = request.body ?? {};
    const repositories = await listGithubRepositories(organizationId, userId);
    const selected = repositories.find((repository) =>
      (body.repositoryId && repository.id === body.repositoryId) ||
      (body.repositoryFullName && repository.fullName === body.repositoryFullName),
    );
    if (!selected) return reply.code(400).send({ error: { code: "SEO_REPOSITORY_NOT_ACCESSIBLE", message: "Ese proyecto no está entre los repositorios accesibles de la conexión." } });
    const now = new Date().toISOString();
    const link = {
      organizationId,
      departmentId: "seo" as const,
      website: dna.website,
      provider: "github" as const,
      repositoryId: selected.id,
      repositoryFullName: selected.fullName,
      defaultBranch: body.defaultBranch?.trim() || selected.defaultBranch,
      access: "read" as const,
      selectedBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    await getSeoRepositoryLinkStore().upsert(link);
    return { organizationId, repository: link, repositoryRead: true, repositoryWrite: false };
  });

  server.post<{ Params: { organizationId: string } }>("/api/departments/seo/:organizationId/audit", async (request, reply) => {
    const { organizationId } = request.params;
    await requireSession(organizationId, deps);
    const dna = await (deps.companyDna?.get(organizationId) ?? Promise.resolve(null));
    if (!dna?.website) return reply.code(409).send({ error: { code: "SEO_WEBSITE_REQUIRED", message: "Conecta o indica la web de tu empresa para iniciar la auditoría." } });
    const store = workStoreForRoutes();
    const now = new Date().toISOString();
    const task = await store.createTask({
      organizationId,
      departmentId: "seo",
      objectiveId: null,
      requestedBy: request.authUser?.id ?? organizationId,
      assignedEmployeeId: null,
      title: "Auditoría SEO de la web",
      summary: dna.website,
      capability: "seo.audit.website" as DepartmentWorkCapability,
      toolId: "departify.seo.audit",
      status: "running",
      statusMessage: "Revisando la web real…",
      progress: 0.1,
      requiredCapabilities: ["seo.audit.website" as DepartmentWorkCapability],
      startedAt: now,
      completedAt: null,
      resultId: null,
      errorCode: null,
      errorMessage: null,
      timeoutMs: 120_000,
    });
    try {
      const report = await auditWebsite(dna.website);
      const repository = await getSeoRepositoryLinkStore().get(organizationId, dna.website);
      let repositoryInspection: Awaited<ReturnType<typeof inspectGithubRepository>> | null = null;
      if (repository && request.authUser?.id) {
        try {
          repositoryInspection = await inspectGithubRepository({
            organizationId,
            userId: request.authUser.id,
            link: repository,
            issueIds: report.issues.map((issue) => issue.id),
          });
        } catch (error) {
          request.log.warn({ event: "seo_repository_read_failed", organizationId, code: error instanceof Error ? error.message : "unknown" });
        }
      }
      const critical = report.issues.filter((issue) => issue.priority === "critical").length;
      const important = report.issues.filter((issue) => issue.priority === "important").length;
      const opportunities = report.issues.filter((issue) => issue.priority === "opportunity").length;
      const result = await store.createResult({
        organizationId,
        departmentId: "seo",
        relatedWorkItemId: task.id,
        title: "Auditoría SEO",
        summary: `${report.issues.length} problemas verificables: ${critical} críticos, ${important} importantes y ${opportunities} oportunidades.`,
        content: [
          `## Auditoría SEO`,
          `Web revisada: ${report.url}`,
          ``,
          `Se revisó title, description, canonical, robots, encabezados, enlaces internos, imágenes, datos estructurados, metadata social y sitemap.`,
          ``,
          ...report.issues.map((issue) => `- **${issue.priority}** ${issue.title} — ${issue.evidence}`),
          ...(repositoryInspection ? [
            "",
            `Proyecto conectado: ${repositoryInspection.repository.fullName}`,
            `Archivos de metadatos localizados: ${repositoryInspection.likelyMetadataFiles.length}.`,
            ...Object.entries(repositoryInspection.issueFileHints).flatMap(([issueId, files]) => files.map((file) => `- ${issueId}: ${file}`)),
          ] : []),
        ].join("\n"),
        data: {
          ...(report as unknown as Record<string, unknown>),
          ...(repositoryInspection ? { repository: repositoryInspection } : {}),
        },
        source: "SEO website audit",
        producedByCapability: "seo.audit.website" as DepartmentWorkCapability,
      });
      const completed = await store.updateTask(task.id, { status: "completed", statusMessage: "Auditoría lista.", progress: 1, completedAt: new Date().toISOString(), resultId: result.id });
      return { organizationId, task: completed, result, report };
    } catch (error) {
      const message = error instanceof Error ? error.message : "No hemos podido completar la auditoría.";
      const failed = await store.updateTask(task.id, { status: "failed", statusMessage: message, completedAt: new Date().toISOString(), errorCode: "seo_audit_failed", errorMessage: message });
      return reply.code(502).send({ organizationId, task: failed, error: { code: "SEO_AUDIT_FAILED", message } });
    }
  });
}

export function __resetDepartmentRouteStoresForTests(): void {
  dashboardStoreSingleton = null;
}

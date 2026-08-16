import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type BusinessCalendarEntry, type DashboardDefinition, type DepartmentResult, type DepartmentTask } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Card, EmptyState, Badge } from "@/components/primitives";
import { DepartmentWorkspaceNav } from "@/components/DepartmentWorkspaceNav";

export function DepartmentDashboardRoute(props: { departmentId: "marketing" | "seo" }) {
  const { organizationId } = useOrg();
  const [dashboards, setDashboards] = useState<DashboardDefinition[]>([]);
  const [tasks, setTasks] = useState<DepartmentTask[]>([]);
  const [results, setResults] = useState<DepartmentResult[]>([]);
  const [calendar, setCalendar] = useState<BusinessCalendarEntry[]>([]);
  const [count, setCount] = useState(0);
  const [limit, setLimit] = useState(5);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [dashboardData, workData, calendarData] = await Promise.all([
      api.dashboards(organizationId, props.departmentId),
      api.workFeed(organizationId),
      api.calendar(organizationId, { departmentId: props.departmentId }),
    ]);
    if (dashboardData) {
      setDashboards(dashboardData.dashboards);
      setSelectedId((current) => current && dashboardData.dashboards.some((item) => item.id === current) ? current : dashboardData.dashboards[0]?.id ?? null);
      setCount(dashboardData.dashboardCount);
      setLimit(dashboardData.dashboardLimit);
    }
    if (workData) {
      setTasks(workData.tasks.filter((task) => task.departmentId === props.departmentId));
      setResults(workData.results.filter((result) => result.departmentId === props.departmentId));
    }
    if (calendarData) setCalendar(calendarData.entries);
    setLoading(false);
  }, [organizationId, props.departmentId]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!organizationId) return;
    setCreating(true);
    setError(null);
    const created = await api.createDashboard(organizationId, props.departmentId, props.departmentId);
    if (!created?.dashboard) {
      setError(count >= limit ? "Ya hay 5 dashboards activos. Elimina uno o reutiliza uno existente." : "No he podido crear el dashboard ahora mismo.");
    } else {
      await load();
    }
    setCreating(false);
  }

  async function archive() {
    if (!organizationId || !dashboard) return;
    await api.archiveDashboard(organizationId, props.departmentId, dashboard.id);
    await load();
  }

  const dashboard = dashboards.find((item) => item.id === selectedId) ?? dashboards[0] ?? null;
  const pending = useMemo(() => tasks.filter((task) => task.status === "queued" || task.status === "running" || task.status === "waiting_approval").length, [tasks]);
  const approvals = useMemo(() => tasks.filter((task) => task.status === "waiting_approval").length + calendar.filter((entry) => entry.status === "needs_approval").length, [tasks, calendar]);
  const completed = useMemo(() => tasks.filter((task) => task.status === "completed").length + results.length, [tasks, results]);

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">{props.departmentId === "marketing" ? "Marketing" : "SEO"}</p>
        <h1>{props.departmentId === "marketing" ? "Dashboards de Marketing" : "Dashboards de SEO"}</h1>
        <DepartmentWorkspaceNav departmentId={props.departmentId} />
        {count === limit - 1 && <p className="dfy-note" role="status">Te queda 1 espacio para dashboards.</p>}
        {count >= limit && <p className="dfy-note" role="status">Has alcanzado los {limit} dashboards activos.</p>}
      </section>

      {loading && <Card><p className="dfy-muted">Cargando datos reales…</p></Card>}
      {error && <p className="dfy-alert" role="alert">{error}</p>}
      {!loading && !dashboard && (
        <Card title="Tu primer dashboard">
          <EmptyState title="Todavía no hay un dashboard" description="Crea una vista operativa basada en el trabajo y los resultados reales de este departamento." />
          <button type="button" className="dfy-button" disabled={creating || count >= limit} onClick={() => void create()}>
            {creating ? "Creando…" : "Crear dashboard"}
          </button>
        </Card>
      )}
      {!loading && dashboard && (
        <>
          {dashboards.length > 1 && <div className="dfy-dashboard-picker" aria-label="Dashboards activos">{dashboards.map((item) => <button key={item.id} type="button" className={`dfy-chip${item.id === dashboard.id ? " dfy-chip--selected" : ""}`} onClick={() => setSelectedId(item.id)}>{item.title}</button>)}</div>}
          <Card title={dashboard.title} action={<span className="dfy-dashboard-card-actions"><Badge tone="success">Activo</Badge><button type="button" className="dfy-button dfy-button--small dfy-button--ghost" onClick={() => void archive()}>Archivar</button></span>}>
            <p className="dfy-muted">{dashboard.description}</p>
            <div className="dfy-dashboard-kpis">
              <Metric label="Pendiente" value={pending} />
              <Metric label="Necesita aprobación" value={approvals} />
              <Metric label="Completado" value={completed} />
            </div>
          </Card>
          <div className="dfy-dashboard-grid">
            {dashboard.widgets.map((widget) => (
              <DashboardWidget key={widget.id} widget={widget} tasks={tasks} results={results} calendar={calendar} />
            ))}
          </div>
          <div className="dfy-dashboard-actions">
            <button type="button" className="dfy-button dfy-button--ghost" disabled={creating || count >= limit} onClick={() => void create()}>
              {creating ? "Creando…" : "Nuevo dashboard"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Metric(props: { label: string; value: number }) {
  return <div className="dfy-dashboard-kpi"><span>{props.label}</span><strong>{props.value}</strong></div>;
}

function DashboardWidget(props: { widget: DashboardDefinition["widgets"][number]; tasks: DepartmentTask[]; results: DepartmentResult[]; calendar: BusinessCalendarEntry[] }) {
  const { widget, tasks, results, calendar } = props;
  if (widget.kind === "metric") {
    return <Card title={widget.title}><div className="dfy-dashboard-kpis"><Metric label="Trabajo" value={tasks.length} /><Metric label="Resultados" value={results.length} /></div></Card>;
  }
  if (widget.kind === "timeline" || widget.kind === "calendar-summary") {
    return <Card title={widget.title}>{calendar.length === 0 ? <EmptyState title="Sin actividad fechada" description="Aparecerá aquí cuando exista trabajo, una aprobación o un evento real." /> : <ol className="dfy-timeline">{calendar.slice(0, 12).map((entry) => <li key={entry.id}><time dateTime={entry.startIso}>{formatDate(entry.startIso)}</time><div><strong>{entry.title}</strong><span>{entry.departmentId} · {statusLabel(entry.status)}</span></div></li>)}</ol>}</Card>;
  }
  if (widget.kind === "table") {
    const rows = [...tasks.map((task) => ({ id: task.id, title: task.title, status: statusLabel(task.status), date: task.createdAt })), ...results.map((result) => ({ id: result.id, title: result.title, status: "Resultado", date: result.createdAt }))].slice(0, 20);
    return <Card title={widget.title}>{rows.length === 0 ? <EmptyState title="Todavía no hay elementos" description="No se muestran filas inventadas: el listado se llenará con trabajo real." /> : <div className="dfy-dashboard-table-wrap"><table className="dfy-result__table"><thead><tr><th>Elemento</th><th>Estado</th><th>Fecha</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.title}</td><td>{row.status}</td><td>{formatDate(row.date)}</td></tr>)}</tbody></table></div>}</Card>;
  }
  return <Card title={widget.title}><EmptyState title="Vista disponible cuando haya datos" description="Este widget usa únicamente fuentes conectadas y resultados verificables." /></Card>;
}

function statusLabel(status: string): string {
  return ({ queued: "Pendiente", running: "En curso", waiting_approval: "Necesita aprobación", completed: "Completado", failed: "Fallido", pending: "Pendiente", needs_approval: "Necesita aprobación", scheduled: "Programado" } as Record<string, string>)[status] ?? status;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(value));
}

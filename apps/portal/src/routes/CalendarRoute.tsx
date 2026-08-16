import { useEffect, useState } from "react";

import { api, type BusinessCalendarEntry } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";

export function CalendarRoute(props: { departmentId?: "marketing" | "seo" }) {
  const { organizationId } = useOrg();
  const [entries, setEntries] = useState<BusinessCalendarEntry[]>([]);
  const [department, setDepartment] = useState(props.departmentId ?? "");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [externalState, setExternalState] = useState<"connected" | "disconnected" | "error">("disconnected");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    void api.calendar(organizationId, {
      ...(department ? { departmentId: department } : {}),
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    }).then((data) => {
      if (data) {
        setEntries(data.entries);
        setExternalState(data.externalState);
      }
      setLoading(false);
    });
  }, [organizationId, department, status, type]);

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Departify</p>
        <h1>{props.departmentId ? `Calendario de ${props.departmentId === "marketing" ? "Marketing" : "SEO"}` : "Calendario"}</h1>
        <p className="dfy-hero__goal">El tiempo operativo de tu empresa, reunido en una sola vista.</p>
      </section>
      <Card>
        <div className="dfy-calendar-filters" aria-label="Filtros de calendario">
          <label>Departamento<select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">Todos</option><option value="marketing">Marketing</option><option value="seo">SEO</option></select></label>
          <label>Tipo<select value={type} onChange={(event) => setType(event.target.value)}><option value="">Todos</option><option value="task">Trabajo</option><option value="result">Resultado</option><option value="approval">Aprobación</option><option value="meeting">Reunión</option></select></label>
          <label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="pending">Pendiente</option><option value="needs_approval">Necesita aprobación</option><option value="scheduled">Programado</option><option value="completed">Completado</option></select></label>
        </div>
        <p className="dfy-muted dfy-muted--small">Google Calendar: {externalState === "connected" ? "conectado" : externalState === "error" ? "necesita atención" : "no conectado"}</p>
      </Card>
      {loading ? <Card><p className="dfy-muted">Cargando calendario…</p></Card> : entries.length === 0 ? <Card><EmptyState title="No hay actividad en este rango" description="Aquí aparecerán tareas, aprobaciones, resultados y reuniones reales cuando existan." /></Card> : <div className="dfy-calendar-list">{entries.map((entry) => <Card key={entry.id}><div className="dfy-calendar-entry"><time dateTime={entry.startIso}>{formatDate(entry.startIso)}</time><div><strong>{entry.title}</strong><p>{entry.summary || "Sin detalle adicional."}</p><span className="dfy-muted dfy-muted--small">{entry.departmentId} · {typeLabel(entry.type)}</span></div><Badge tone={entry.status === "needs_approval" ? "warning" : entry.status === "failed" ? "danger" : entry.status === "completed" ? "success" : "neutral"}>{statusLabel(entry.status)}</Badge></div></Card>)}</div>}
    </div>
  );
}

function formatDate(value: string): string { return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(value)); }
function typeLabel(value: string): string { return ({ task: "Trabajo", result: "Resultado", approval: "Aprobación", meeting: "Reunión" } as Record<string, string>)[value] ?? value; }
function statusLabel(value: string): string { return ({ pending: "Pendiente", needs_approval: "Necesita aprobación", scheduled: "Programado", completed: "Completado", failed: "Fallido" } as Record<string, string>)[value] ?? value; }

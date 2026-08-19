/**
 * /weekly-plan — the Operating Loop entry point.
 *
 * The CEO states the weekly objective. Departify turns it into a
 * structured plan (one or more days). When accepted, every actionable
 * item becomes a durable DepartmentTask with a `plannedDate` and a
 * `weekly_plan` source, so it appears in Kanban + Calendar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  api,
  type WeeklyPlan,
  type WeeklyPlanItem,
  type WeeklyPlanView,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { cssVarsFor, DepartmentChip } from "@/components/DepartmentChip";
import { Badge } from "@/components/primitives";

function currentWeekStartIso(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

const DAY_LABELS: readonly string[] = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];

interface DraftItem {
  id: string;
  dayOfWeek: number;
  title: string;
  summary: string;
  capability: string;
  toolId: string;
  requiresApproval: boolean;
  plannedHour: number;
}

const EMPTY_DRAFT = (): DraftItem[] => [
  {
    id: genId(),
    dayOfWeek: 0,
    title: "Revisar campañas activas",
    summary: "Comprobar CTR y CPC de los anuncios en curso.",
    capability: "marketing.ads.metrics.read",
    toolId: "marketing.ads.metrics.read",
    requiresApproval: false,
    plannedHour: 9,
  },
  {
    id: genId(),
    dayOfWeek: 1,
    title: "Preparar creatividades",
    summary: "Tres variantes para la campaña de la semana.",
    capability: "marketing.meta.ads.prepare",
    toolId: "marketing.meta.ads.prepare",
    requiresApproval: false,
    plannedHour: 10,
  },
  {
    id: genId(),
    dayOfWeek: 2,
    title: "Lanzar campaña",
    summary: "Publicar creatividades tras aprobación del CEO.",
    capability: "marketing.meta.ads.publish",
    toolId: "marketing.meta.ads.publish",
    requiresApproval: true,
    plannedHour: 11,
  },
  {
    id: genId(),
    dayOfWeek: 3,
    title: "Revisar rendimiento",
    summary: "Informe diario y ajustes.",
    capability: "marketing.ads.metrics.read",
    toolId: "marketing.ads.metrics.read",
    requiresApproval: false,
    plannedHour: 9,
  },
];

function genId(): string {
  return `wpi_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function WeeklyPlanRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [view, setView] = useState<WeeklyPlanView | null>(null);
  const [draft, setDraft] = useState<DraftItem[]>(() => EMPTY_DRAFT());
  const [objective, setObjective] = useState(
    "Conseguir 20 leads cualificados esta semana.",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const response = await api.weeklyPlanCurrent(organizationId);
    if (response?.plan) {
      const plan = response.plan;
      setView({ organizationId, plan, weekStartIso: plan.weekStartIso });
      setObjective(plan.objective);
      setDraft(
        plan.items.map((item: WeeklyPlanItem) => ({
          id: item.id,
          dayOfWeek: item.dayOfWeek,
          title: item.title,
          summary: item.summary,
          capability: item.capability as unknown as string,
          toolId: item.toolId,
          requiresApproval: item.requiresApproval,
          plannedHour: item.plannedHour ?? 9,
        })),
      );
    }
    setLoaded(true);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedByDay = useMemo(() => {
    const groups: DraftItem[][] = [[], [], [], [], [], [], []];
    for (const item of draft) {
      const idx = Math.max(0, Math.min(6, item.dayOfWeek));
      groups[idx]!.push(item);
    }
    return groups;
  }, [draft]);

  const updateItem = (id: string, patch: Partial<DraftItem>) => {
    setDraft((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };
  const removeItem = (id: string) => {
    setDraft((items) => items.filter((item) => item.id !== id));
  };
  const addItem = (dayOfWeek: number) => {
    setDraft((items) => [
      ...items,
      {
        id: genId(),
        dayOfWeek,
        title: "",
        summary: "",
        capability: "marketing.ads.metrics.read",
        toolId: "marketing.ads.metrics.read",
        requiresApproval: false,
        plannedHour: 9,
      },
    ]);
  };

  async function save(accept: boolean) {
    if (!organizationId || busy) return;
    if (!objective.trim()) {
      setError("Indica el objetivo de la semana.");
      return;
    }
    setBusy(true);
    setError(null);
    const created = await api.weeklyPlanSave(organizationId, {
      objective: objective.trim(),
      items: draft.map((item) => ({
        id: item.id,
        dayOfWeek: item.dayOfWeek,
        title: item.title.trim(),
        summary: item.summary.trim(),
        capability: item.capability,
        toolId: item.toolId.trim(),
        requiresApproval: item.requiresApproval,
        plannedHour: item.plannedHour,
      })),
    });
    if (!created || (created as { error?: { code?: string } }).error) {
      setBusy(false);
      setError("No hemos podido guardar el plan. Inténtalo de nuevo.");
      return;
    }
    const plan = (created as WeeklyPlanView).plan;
    if (!plan) {
      setBusy(false);
      setError("No hemos podido guardar el plan. Inténtalo de nuevo.");
      return;
    }
    if (!accept) {
      setBusy(false);
      setView({ organizationId, plan, weekStartIso: plan.weekStartIso });
      setInfo("Plan guardado en borrador.");
      return;
    }
    const accepted = await api.weeklyPlanAccept(organizationId, plan.id);
    setBusy(false);
    if (!accepted || (accepted as { error?: { code?: string } }).error) {
      setError("No hemos podido aceptar el plan. Inténtalo de nuevo.");
      return;
    }
    const acceptedPlan = (accepted as { plan?: WeeklyPlan | null }).plan ?? null;
    setView({
      organizationId,
      plan: acceptedPlan,
      weekStartIso: acceptedPlan?.weekStartIso ?? currentWeekStartIso(),
    });
    setInfo(
      `Plan aceptado. ${(accepted as { tasksCreated?: number }).tasksCreated ?? 0} tareas creadas y programadas en Kanban y Calendario.`,
    );
    setTimeout(() => navigate("/tareas"), 1200);
  }

  const accent = cssVarsFor({
    id: "marketing",
    label: "Marketing",
    shortLabel: "Mkt",
    accentVar: "--dfy-dept-marketing-accent",
    tintVar: "--dfy-dept-marketing-tint",
    tintStrongVar: "--dfy-dept-marketing-tint-strong",
    borderVar: "--dfy-dept-marketing-border",
    initial: "M",
  });

  return (
    <div className="dfy-page dfy-weekly-plan-page" data-testid="weekly-plan-route">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Plan semanal</p>
        <h1>Qué va a conseguir tu empresa esta semana</h1>
        <p className="dfy-hero__lead">
          Escribe el objetivo. Departify lo convierte en tareas
          programadas que aparecen en Kanban y Calendario.
        </p>
      </section>

      {error && <p className="dfy-alert" role="alert">{error}</p>}
      {info && <p className="dfy-card__description" role="status">{info}</p>}

      {loaded && view?.plan?.status === "accepted" && (
        <section className="dfy-card">
          <Badge tone="success">Plan ya aceptado</Badge>
          <p className="dfy-muted dfy-muted--small">
            Esta semana ya tiene un plan aceptado. Las tareas resultantes
            están en Kanban y Calendario. Si quieres reemplazarlo, edita
            el borrador y vuelve a aceptarlo.
          </p>
        </section>
      )}

      <section className="dfy-card" style={accent}>
        <label htmlFor="weekly-plan-objective">Objetivo de la semana</label>
        <input
          id="weekly-plan-objective"
          type="text"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="p.ej. Conseguir 20 leads cualificados"
          maxLength={200}
        />
      </section>

      <section className="dfy-card" style={accent}>
        <h2>Trabajo programado</h2>
        {groupedByDay.map((items, dayIndex) => (
          <div key={dayIndex} className="dfy-plan-day">
            <div className="dfy-plan-day__label">{DAY_LABELS[dayIndex]}</div>
            <div className="dfy-plan-day__items">
              {items.length === 0 ? (
                <p className="dfy-muted dfy-muted--small">
                  Nada programado.{" "}
                  <button
                    type="button"
                    className="dfy-link"
                    onClick={() => addItem(dayIndex)}
                  >
                    Añadir tarea
                  </button>
                </p>
              ) : (
                items.map((item) => (
                  <PlanItemRow
                    key={item.id}
                    item={item}
                    onChange={(patch) => updateItem(item.id, patch)}
                    onRemove={() => removeItem(item.id)}
                  />
                ))
              )}
              {items.length > 0 && (
                <button
                  type="button"
                  className="dfy-button dfy-button--small dfy-button--ghost"
                  onClick={() => addItem(dayIndex)}
                >
                  Añadir tarea
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="dfy-card dfy-card--actions">
        <div className="dfy-card__actions">
          <button
            type="button"
            className="dfy-button dfy-button--ghost"
            disabled={busy}
            onClick={() => save(false)}
          >
            {busy ? "Guardando…" : "Guardar borrador"}
          </button>
          <button
            type="button"
            className="dfy-button"
            disabled={busy}
            onClick={() => save(true)}
          >
            {busy ? "Aceptando…" : "Aceptar plan y crear tareas"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface PlanItemRowProps {
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove: () => void;
}

function PlanItemRow(props: PlanItemRowProps) {
  const accent = cssVarsFor({
    id: "marketing",
    label: "Marketing",
    shortLabel: "Mkt",
    accentVar: "--dfy-dept-marketing-accent",
    tintVar: "--dfy-dept-marketing-tint",
    tintStrongVar: "--dfy-dept-marketing-tint-strong",
    borderVar: "--dfy-dept-marketing-border",
    initial: "M",
  });
  return (
    <div className="dfy-plan-item" style={accent}>
      <DepartmentChip departmentId="marketing" showLabel={false} />
      <div>
        <input
          type="text"
          value={props.item.title}
          placeholder="Título de la tarea"
          onChange={(event) => props.onChange({ title: event.target.value })}
        />
        <input
          type="text"
          value={props.item.summary}
          placeholder="Detalle breve"
          onChange={(event) => props.onChange({ summary: event.target.value })}
        />
      </div>
      <div className="dfy-plan-item__meta">
        <label>
          <input
            type="checkbox"
            checked={props.item.requiresApproval}
            onChange={(event) => props.onChange({ requiresApproval: event.target.checked })}
          />
          Requiere aprobación
        </label>
        <button
          type="button"
          className="dfy-button dfy-button--small dfy-button--ghost"
          onClick={props.onRemove}
        >
          Quitar
        </button>
      </div>
    </div>
  );
}

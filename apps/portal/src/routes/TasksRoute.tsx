import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  api,
  type CompanyStatus,
  type DepartmentResult,
  type DepartmentTask,
  type HeadIdentity,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { cssVarsFor, DepartmentChip } from "@/components/DepartmentChip";
import { Badge } from "@/components/primitives";
import {
  DEPARTMENT_VISUAL_IDENTITY,
  visualIdentityForDepartment,
} from "@/app/department-visual-identity";

/**
 * Tareas — the Operating Loop Kanban.
 *
 * Columns map to DepartmentTask.status so the visual state is always
 * the truthful backend state. Cards carry the department Visual
 * Identity accent (border + chip) so the CEO recognizes the owning
 * department before reading the badge text.
 */
type KanbanColumnId = "todo" | "doing" | "approval" | "done";

const COLUMNS: ReadonlyArray<{ id: KanbanColumnId; title: string }> = [
  { id: "todo", title: "Por hacer" },
  { id: "doing", title: "En curso" },
  { id: "approval", title: "Esperando aprobación" },
  { id: "done", title: "Hecho" },
];

function statusToColumn(status: string | undefined): KanbanColumnId {
  switch (status) {
    case "running":
      return "doing";
    case "waiting_approval":
      return "approval";
    case "completed":
      return "done";
    case "failed":
    case "cancelled":
      return "done";
    case "queued":
    default:
      return "todo";
  }
}

export function TasksRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusedTaskId = searchParams.get("taskId");
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [tasks, setTasks] = useState<DepartmentTask[]>([]);
  const [results, setResults] = useState<DepartmentResult[]>([]);
  const [head, setHead] = useState<HeadIdentity | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [statusData, handoff, workFeed, resultsResp] = await Promise.all([
      api.status(organizationId),
      api.handoff(organizationId),
      api.workFeed(organizationId),
      api.results(organizationId),
    ]);
    if (statusData) setStatus(statusData);
    if (handoff) setHead(handoff.head);
    setTasks(workFeed?.tasks ?? []);
    setResults(resultsResp?.results ?? []);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map: Record<KanbanColumnId, DepartmentTask[]> = {
      todo: [],
      doing: [],
      approval: [],
      done: [],
    };
    for (const task of tasks) map[statusToColumn(task.status)].push(task);
    return map;
  }, [tasks]);

  const resultByTask = useMemo(() => {
    const map = new Map<string, DepartmentResult>();
    for (const result of results) {
      if (result.relatedWorkItemId) map.set(result.relatedWorkItemId, result);
    }
    return map;
  }, [results]);

  async function moveTask(task: DepartmentTask, column: KanbanColumnId) {
    if (!organizationId || busy) return;
    const targetStatus =
      column === "todo"
        ? "queued"
        : column === "doing"
          ? "running"
          : column === "approval"
            ? "waiting_approval"
            : task.status === "running" || task.status === "queued"
              ? "cancelled"
              : "completed";
    setBusy(task.id);
    setError(null);
    const result = await api.taskTransition(
      organizationId,
      task.id,
      targetStatus,
    );
    setBusy(null);
    if (!result || (result as { error?: { code?: string } }).error) {
      setError(
        "Departify no puede mover esta tarea en ese sentido. Las tareas terminan cuando la capacidad que las cierra termina su ejecución.",
      );
      return;
    }
    await load();
  }

  function openInChat(task: DepartmentTask) {
    const focus = encodeURIComponent(`¿En qué punto está "${task.title}"? (ref ${task.id})`);
    navigate(`/chat?focus=${focus}`);
  }

  const planningAvailable =
    tasks.length === 0 ||
    (tasks.length > 0 && grouped.todo.length === 0 && grouped.doing.length === 0);

  return (
    <div className="dfy-page dfy-tasks-page" data-testid="tasks-route">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Tareas</p>
        <h1>El trabajo de tu empresa</h1>
        <p className="dfy-hero__lead">
          Lo que están haciendo los departamentos: por hacer, en curso,
          esperando tu aprobación y hecho. Arrastra una tarjeta para
          cambiar su estado cuando proceda.
        </p>
        <div className="dfy-hero__actions">
          <button
            type="button"
            className="dfy-button"
            onClick={() => navigate("/weekly-plan")}
          >
            Planificar semana
          </button>
        </div>
      </section>

      {error && (
        <p className="dfy-alert" role="alert">
          {error}
        </p>
      )}

      {tasks.length === 0 ? (
        <section className="dfy-card">
          <h2>Aún no hay tareas</h2>
          <p>
            En cuanto el equipo empiece a trabajar verás aquí lo que hay
            en curso. La forma más rápida de arrancar es planificar la
            semana o pedirle a Departify lo que quieres conseguir.
          </p>
          <button
            type="button"
            className="dfy-button"
            onClick={() => navigate("/weekly-plan")}
          >
            Planificar semana
          </button>
        </section>
      ) : (
        <div className="dfy-kanban" data-testid="tasks-kanban">
          {COLUMNS.map((column) => {
            const columnTasks = grouped[column.id];
            const accentIdentity =
              column.id === "approval"
                ? DEPARTMENT_VISUAL_IDENTITY.direccion
                : column.id === "done"
                  ? DEPARTMENT_VISUAL_IDENTITY.ingenieria
                  : DEPARTMENT_VISUAL_IDENTITY.marketing;
            const style = cssVarsFor(accentIdentity);
            return (
              <section
                key={column.id}
                className="dfy-kanban__column"
                style={style}
                data-column={column.id}
                data-testid={`kanban-${column.id}`}
              >
                <header className="dfy-kanban__column-head">
                  <span>{column.title}</span>
                  <span className="dfy-kanban__count">{columnTasks.length}</span>
                </header>
                {columnTasks.length === 0 ? (
                  <p className="dfy-muted dfy-muted--small">
                    Nada por aquí todavía.
                  </p>
                ) : (
                  columnTasks.map((task) => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      result={resultByTask.get(task.id) ?? null}
                      focused={task.id === focusedTaskId}
                      busy={busy === task.id}
                      onMove={(columnId) => moveTask(task, columnId)}
                      onOpen={() => openInChat(task)}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}

      {planningAvailable && tasks.length > 0 && (
        <section className="dfy-card">
          <h2>¿Quieres planificar la semana?</h2>
          <p>
            El CEO define el objetivo semanal. Departify lo convierte en
            tareas reales con fecha, departamento y capacidad.
          </p>
          <button
            type="button"
            className="dfy-button dfy-button--ghost"
            onClick={() => navigate("/weekly-plan")}
          >
            Ir al plan semanal
          </button>
        </section>
      )}

      {head && (
        <section className="dfy-card">
          <h2>Departamentos trabajando</h2>
          <ul className="dfy-list">
            <li>
              <DepartmentChip departmentId="marketing" showLabel />
              <span className="dfy-muted dfy-muted--small">
                {" "}
                · {head.name} ({head.role})
              </span>
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}

interface KanbanCardProps {
  task: DepartmentTask;
  result: DepartmentResult | null;
  focused: boolean;
  busy: boolean;
  onMove: (column: KanbanColumnId) => void;
  onOpen: () => void;
}

function KanbanCard(props: KanbanCardProps) {
  const identity = visualIdentityForDepartment(props.task.departmentId);
  const style = cssVarsFor(identity);
  const isDone =
    props.task.status === "completed" ||
    props.task.status === "cancelled" ||
    props.task.status === "failed";
  return (
    <article
      className={`dfy-kanban__card${props.focused ? " dfy-kanban__card--focused" : ""}`}
      style={style}
      data-department={identity.id}
      data-task-id={props.task.id}
    >
      <button
        type="button"
        className="dfy-kanban__card-title"
        onClick={props.onOpen}
        aria-label={`Abrir ${props.task.title} en el chat`}
      >
        {props.task.title}
      </button>
      <div className="dfy-kanban__card-meta">
        <DepartmentChip departmentId={props.task.departmentId} />
        <span>{statusLabel(props.task.status)}</span>
        <TimingBadge task={props.task} />
      </div>
      {props.task.summary ? (
        <p className="dfy-muted dfy-muted--small">{props.task.summary}</p>
      ) : null}
      {props.result ? (
        <button
          type="button"
          className="dfy-button dfy-button--small dfy-button--ghost"
          onClick={props.onOpen}
        >
          Ver resultado
        </button>
      ) : null}
      {!isDone ? (
        <div className="dfy-kanban__card-meta">
          {props.task.status === "queued" ? (
            <button
              type="button"
              className="dfy-button dfy-button--small"
              disabled={props.busy}
              onClick={() => props.onMove("doing")}
            >
              Empezar
            </button>
          ) : null}
          {props.task.status === "running" ? (
            <button
              type="button"
              className="dfy-button dfy-button--small dfy-button--ghost"
              disabled={props.busy}
              onClick={() => props.onMove("todo")}
            >
              Pausar
            </button>
          ) : null}
          {props.task.status === "waiting_approval" ? (
            <button
              type="button"
              className="dfy-button dfy-button--small"
              disabled={props.busy}
              onClick={() => props.onMove("doing")}
            >
              Aprobar
            </button>
          ) : null}
          <button
            type="button"
            className="dfy-button dfy-button--small dfy-button--ghost"
            disabled={props.busy}
            onClick={() => props.onMove("done")}
          >
            Archivar
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TimingBadge({ task }: { task: DepartmentTask }) {
  if (task.status === "completed" && task.startedAt && task.completedAt) {
    const ms =
      new Date(task.completedAt).getTime() -
      new Date(task.startedAt).getTime();
    return <span>· {humanDuration(ms)}</span>;
  }
  if (task.status === "running" && task.startedAt) {
    const ms = Date.now() - new Date(task.startedAt).getTime();
    return <span>· {humanDuration(ms)}</span>;
  }
  if (task.status === "queued" && task.plannedDate) {
    return <span>· {formatPlanned(task.plannedDate)}</span>;
  }
  return null;
}

function humanDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `En curso · ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `En curso · ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} h ${remainingMinutes} min`;
}

function formatPlanned(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "Pendiente";
    case "running":
      return "En curso";
    case "waiting_approval":
      return "Esperando aprobación";
    case "completed":
      return "Terminado";
    case "failed":
      return "Falló";
    case "cancelled":
      return "Cancelado";
    default:
      return status;
  }
}

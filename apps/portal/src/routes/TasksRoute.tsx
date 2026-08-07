import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type CompanyStatus, type HeadIdentity } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { readable } from "@/app/readable";
import { TasksIcon } from "@/components/icons";

/**
 * Tareas — the operational inbox.
 *
 * Real work items, no demos. Clicking a task returns to the central
 * chat with the task as context, so the CEO never has to negotiate
 * the chat with a separate task UI.
 */
export function TasksRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [head, setHead] = useState<HeadIdentity | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [statusData, handoff] = await Promise.all([
      api.status(organizationId),
      api.handoff(organizationId),
    ]);
    if (statusData) setStatus(statusData);
    if (handoff) setHead(handoff.head);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runItem(itemId: string, action: "execute" | "approve") {
    if (!organizationId) return;
    setBusy(itemId);
    setError(null);
    const result = await api.itemAction(organizationId, itemId, action);
    setBusy(null);
    if (!result || result.error) {
      setError("Departify no ha podido terminar esto ahora mismo. Inténtalo de nuevo.");
      return;
    }
    await load();
  }

  const items = status?.marketingWork?.items ?? [];
  const departments = [
    { id: "marketing", name: "Marketing", head },
  ];

  // Group by status for the inbox: needs_approval first (urgency),
  // then running/pending, then completed/unavailable.
  const grouped = {
    pending: items.filter((it) => it.status === "needs_approval"),
    active: items.filter((it) => it.status === "running" || it.status === "pending" || it.status === "approved"),
    done: items.filter((it) => it.status === "completed"),
    blocked: items.filter((it) => it.status === "unavailable" || it.status === "failed"),
  };

  function openInChat(itemId: string, title: string) {
    const focus = encodeURIComponent(`¿En qué punto está "${title}"? (ref ${itemId})`);
    navigate(`/chat?focus=${focus}`);
  }

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Tareas</p>
        <h1>El trabajo de tu empresa</h1>
        <p className="dfy-hero__lead">
          Lo que están haciendo los departamentos, en curso, esperando
          aprobación y terminado. Cualquier tarea abre su conversación en
          el chat.
        </p>
      </section>

      {error && (
        <p className="dfy-alert" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <section className="dfy-card">
          <TasksIcon size={28} />
          <h2>Aún no hay tareas</h2>
          <p>
            En cuanto el equipo empiece a trabajar verás aquí lo que hay
            en curso. La forma más rápida de arrancar es ir al chat y
            contarle a Departify qué quieres conseguir.
          </p>
          <button
            type="button"
            className="dfy-button"
            onClick={() => navigate("/chat")}
          >
            Ir al chat
          </button>
        </section>
      ) : (
        <>
          {grouped.pending.length > 0 && (
            <TaskGroup
              title="Esperan tu decisión"
              empty={false}
              items={grouped.pending}
              head={head}
              runningItem={busy}
              onAction={runItem}
              onOpen={openInChat}
              actionLabel="Aprobar"
              actionKind="approve"
            />
          )}
          {grouped.active.length > 0 && (
            <TaskGroup
              title="En curso"
              items={grouped.active}
              head={head}
              runningItem={busy}
              onAction={runItem}
              onOpen={openInChat}
              actionLabel="Que lo hagan"
              actionKind="execute"
            />
          )}
          {grouped.blocked.length > 0 && (
            <TaskGroup
              title="Bloqueadas"
              items={grouped.blocked}
              head={head}
              runningItem={busy}
              onAction={runItem}
              onOpen={openInChat}
              actionLabel="Pedir desbloqueo"
              actionKind="execute"
            />
          )}
          {grouped.done.length > 0 && (
            <TaskGroup
              title="Terminadas"
              items={grouped.done}
              head={head}
              runningItem={busy}
              onAction={runItem}
              onOpen={openInChat}
              actionLabel="Reabrir"
              actionKind="execute"
            />
          )}
        </>
      )}

      {departments.length > 0 && (
        <section className="dfy-card">
          <h2>Departamentos trabajando</h2>
          <ul className="dfy-list">
            {departments.map((d) => (
              <li key={d.id}>
                <strong>{d.name}</strong>
                {d.head && (
                  <span className="dfy-muted dfy-muted--small">
                    {" "}
                    · {d.head.name} ({d.head.role})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TaskGroup(props: {
  title: string;
  empty?: boolean;
  items: CompanyStatus["marketingWork"] extends infer T
    ? T extends { items: readonly (infer I)[] }
      ? I[]
      : never
    : never;
  head: HeadIdentity | null;
  runningItem: string | null;
  onAction: (itemId: string, action: "execute" | "approve") => void;
  onOpen: (itemId: string, title: string) => void;
  actionLabel: string;
  actionKind: "execute" | "approve";
}) {
  if (props.empty) return null;
  return (
    <section className="dfy-card">
      <h2>{props.title}</h2>
      <ul className="dfy-task-list">
        {props.items.map((item) => (
          <li key={item.id} className="dfy-task">
            <div className="dfy-task__head">
              <strong>{item.title}</strong>
              <span className={`dfy-task__status dfy-task__status--${item.status ?? "pending"}`}>
                {labelForStatus(item.status ?? "pending")}
              </span>
            </div>
            <p className="dfy-muted">{item.description}</p>
            {item.result && <p className="dfy-task__result">{readable(item.result)}</p>}
            <div className="dfy-task__actions">
              <button
                type="button"
                className="dfy-button dfy-button--ghost dfy-button--small"
                onClick={() => props.onOpen(item.id, item.title)}
              >
                Abrir en el chat
              </button>
              {props.actionKind !== "execute" && (
                <button
                  type="button"
                  className="dfy-button dfy-button--small"
                  disabled={props.runningItem === item.id}
                  onClick={() => props.onAction(item.id, "approve")}
                >
                  {props.actionLabel}
                </button>
              )}
              {props.actionKind === "execute" && (
                <button
                  type="button"
                  className="dfy-button dfy-button--small"
                  disabled={props.runningItem === item.id}
                  onClick={() => props.onAction(item.id, "execute")}
                >
                  {props.actionLabel}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function labelForStatus(status: string): string {
  switch (status) {
    case "needs_approval":
      return "Esperando aprobación";
    case "approved":
      return "Aprobado";
    case "completed":
      return "Terminado";
    case "running":
      return "En marcha";
    case "failed":
      return "Falló";
    case "unavailable":
      return "Bloqueada";
    default:
      return "Preparado";
  }
}

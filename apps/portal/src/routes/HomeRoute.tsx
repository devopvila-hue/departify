import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  api,
  type CeoOverview,
  type CommandCenterEvent,
  type CommandCenterMessageResult,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState, HeadBadge } from "@/components/primitives";
import { readable } from "@/app/readable";

/**
 * Dirección — the CEO Command Center (Sprint 58).
 *
 * Single chat. The CEO talks to DEPARTIFY. The chat is the primary surface:
 * the CEO does not choose a department, agent or employee. The Command
 * Center routes the message, surfaces what is happening, and presents
 * approvals, results, connection needs and team visibility as cards in the
 * conversation.
 *
 * The remaining sections (decisions, results, departments, activity) are
 * contextual — they reflect the same data the chat shows, plus a few
 * shortcuts. No demo numbers. Empty states are real.
 */
export function HomeRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<CeoOverview | null>(null);
  const [events, setEvents] = useState<readonly CommandCenterEvent[]>([]);
  const [transcript, setTranscript] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId) return;
    try {
      const [overviewData, openingData, statusData] = await Promise.all([
        api.overview(organizationId),
        api.commandCenterOpening(organizationId),
        api.status(organizationId),
      ]);
      if (overviewData) setOverview(overviewData);
      if (openingData) setEvents(openingData.events);
      if (statusData) {
        const conv = statusData.conversation.map((turn) => ({
          role: turn.role as "user" | "assistant",
          content: turn.content,
        }));
        setTranscript(conv);
      }
    } catch {
      setError("No he podido cargar el estado de tu empresa ahora mismo. Inténtalo de nuevo en un momento.");
    } finally {
      setOpening(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    const value = input.trim();
    if (!organizationId || !value || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    setTranscript((prev) => [...prev, { role: "user", content: value }]);
    const result: CommandCenterMessageResult | null =
      await api.commandCenterMessage(organizationId, value);
    setBusy(false);
    if (!result) {
      setError(
        "Departify no ha podido responderte ahora mismo. Vuelve a intentarlo en un momento.",
      );
      return;
    }
    setTranscript((prev) => [
      ...prev,
      { role: "assistant", content: result.reply },
    ]);
    setEvents(result.events);
    await load();
  }

  const pendingDecisions = useMemo(
    () => overview?.decisions.filter((d) => d.status === "pending") ?? [],
    [overview],
  );

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Dirección</p>
        <h1>Dile a Departify qué necesitas</h1>
        <p className="dfy-hero__lead">
          Háblalo con tus palabras. Departify sabe qué departamento tiene que
          trabajar y ya tiene a quién poner con ello.
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

      <Card title="Actividad de tu empresa">
        <p className="dfy-muted dfy-muted--small">
          Tu única conversación con la empresa. Cuando Elvira y su equipo
          necesiten tu decisión, aparecerá aquí mismo.
        </p>

        {events.length > 0 && (
          <div className="dfy-cc-events">
            {events.map((event, index) => (
              <CommandCenterEventCard key={`op_${index}_${event.kind}`} event={event} />
            ))}
          </div>
        )}

        <div className="dfy-chat">
          {transcript.length === 0 && !opening && (
            <p className="dfy-muted">
              No hemos hablado todavía. Arriba tienes lo que Elvira ya tiene
              preparado. Cuéntame qué necesitas.
            </p>
          )}
          {transcript.map((turn, index) => (
            <div
              key={`turn_${index}`}
              className={`dfy-bubble${turn.role === "user" ? " dfy-bubble--user" : ""}`}
            >
              <span className="dfy-bubble__who">
                {turn.role === "user" ? "Tú" : "Departify"}
              </span>
              <p>{turn.content}</p>
            </div>
          ))}
        </div>

        <div className="dfy-composer">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void send();
            }}
            placeholder="Quiero conseguir más clientes."
            aria-label="Mensaje para Departify"
            disabled={busy}
          />
          <button
            type="button"
            className="dfy-button"
            onClick={() => void send()}
            disabled={busy || input.trim().length === 0}
          >
            {busy ? "Enviando…" : "Enviar"}
          </button>
        </div>

        {error && (
          <p className="dfy-alert" role="alert">
            {error}
          </p>
        )}
      </Card>

      <div className="dfy-grid">
        {overview?.team && overview.team.specialists.length > 0 && (
          <Card title="Equipo de Marketing">
            <p className="dfy-muted dfy-muted--small">
              Información: este es el equipo que Elvira tiene formando para tu
              objetivo y el trabajo que tiene en marcha.
            </p>
            <div className="dfy-team-grid">
              <div className="dfy-team-director">
                <HeadBadge
                  head={{
                    departmentId: "marketing",
                    department: "Marketing",
                    name: overview.team.director.name,
                    initials: overview.team.director.initials,
                    role: overview.team.director.role,
                  }}
                />
              </div>
              {overview.team.specialists.map((spec) => (
                <div key={spec.id} className="dfy-team-member">
                  <div className="dfy-team-member__name">{spec.name}</div>
                  <div className="dfy-team-member__role">{spec.role}</div>
                  <Badge
                    tone={
                      spec.status === "preparando" || spec.status === "trabajando"
                        ? "accent"
                        : spec.status === "completado"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {spec.status === "preparando"
                      ? "Preparando"
                      : spec.status === "trabajando"
                        ? "Trabajando"
                        : spec.status === "esperando"
                          ? "Esperando conexión"
                          : spec.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        {overview && overview.heads.length > 0 && (
          <Card title="Departamentos">
            <ul className="dfy-list">
              {overview.heads.map((head) => (
                <li key={head.departmentId}>
                  <HeadBadge head={head} compact />
                  <Badge tone="success">Operativo</Badge>
                  <button
                    type="button"
                    className="dfy-button dfy-button--ghost"
                    onClick={() => navigate(head.departmentId === "seo" ? "/seo" : "/marketing")}
                  >
                    Abrir departamento
                  </button>
                </li>
              ))}
            </ul>
            <p className="dfy-muted dfy-muted--small">
              Aquí verás los departamentos activos de tu empresa.
            </p>
          </Card>
        )}

        <Card title="Necesita tu decisión">
          {pendingDecisions.length === 0 ? (
            <EmptyState
              title="Nada pendiente"
              description="Cuando Elvira o cualquier jefe de departamento necesite tu aprobación aparecerá también en el chat."
            />
          ) : (
            <ul className="dfy-list">
              {pendingDecisions.map((decision) => (
                <li key={decision.id}>
                  <HeadBadge head={decision.head} compact />
                  <p>{decision.proposal}</p>
                  <button
                    type="button"
                    className="dfy-button dfy-button--ghost"
                    onClick={() => navigate("/decisiones")}
                  >
                    Ver propuesta
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Actividad">
          {(overview?.activity.length ?? 0) === 0 ? (
            <EmptyState
              title="Todavía no hay actividad"
              description="En cuanto Elvira empiece a mover algo, lo verás aquí."
            />
          ) : (
            <ul className="dfy-activity">
              {overview?.activity.map((entry) => (
                <li
                  key={entry.id}
                  className={`dfy-activity__item dfy-activity__item--${entry.tone}`}
                >
                  <span className="dfy-activity__dot" aria-hidden="true" />
                  <span>{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Resultados">
          {(overview?.results.length ?? 0) === 0 ? (
            <EmptyState
              title="Aún sin entregables"
              description="Cuando el equipo termine algo, aparecerá en el chat y aquí."
            />
          ) : (
            <ul className="dfy-list">
              {overview?.results.slice(0, 3).map((result) => (
                <li key={result.id}>
                  <strong>{result.title}</strong>
                  <p className="dfy-muted">{truncate(result.summary, 180)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function CommandCenterEventCard(props: { event: CommandCenterEvent }) {
  const { event } = props;
  switch (event.kind) {
    case "intent_proactive":
      return (
        <article className="dfy-cc-event dfy-cc-event--proactive">
          <header>
            <strong>{event.title}</strong>
          </header>
          <p>{event.message}</p>
        </article>
      );
    case "department_active":
      return (
        <article className="dfy-cc-event dfy-cc-event--department">
          <header>
            <strong>{event.departmentName}</strong>
            <Badge tone="success">Operativo</Badge>
          </header>
          <p>
            {event.directorName} ({event.directorRole}) está al mando.
          </p>
          {event.team && event.team.specialists.length > 0 && (
            <ul className="dfy-cc-team">
              {event.team.specialists.map((spec) => (
                <li key={spec.id}>
                  <span>{spec.name}</span>
                  <Badge
                    tone={
                      spec.status === "preparando" ||
                      spec.status === "trabajando"
                        ? "accent"
                        : spec.status === "completado"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {spec.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </article>
      );
    case "connection_need":
      return (
        <article className="dfy-cc-event dfy-cc-event--connection">
          <header>
            <strong>{event.suggestion.label}</strong>
            <Badge tone={event.suggestion.connectable ? "warning" : "neutral"}>
              {event.suggestion.connectable ? "Por conectar" : "En preparación"}
            </Badge>
          </header>
          <p>{event.suggestion.why}</p>
          {event.suggestion.requiredCredentials.length > 0 && (
            <p className="dfy-muted dfy-muted--small">
              Departify te pedirá estas credenciales en una ventana segura.
              Nunca aparecen en el chat ni en la información de tu empresa.
            </p>
          )}
        </article>
      );
    case "approval_request":
      return (
        <article className="dfy-cc-event dfy-cc-event--approval">
          <header>
            <strong>{event.item.title}</strong>
            <Badge tone="warning">Espera tu aprobación</Badge>
          </header>
          <p>{event.proposal}</p>
          <p className="dfy-muted">{event.detail}</p>
        </article>
      );
    case "result":
      return (
        <article className="dfy-cc-event dfy-cc-event--result">
          <header>
            <strong>{event.item.title}</strong>
            <Badge tone="success">Terminado</Badge>
          </header>
          {event.item.result && <p>{readable(event.item.result)}</p>}
        </article>
      );
    case "work_update":
      return (
        <article className="dfy-cc-event dfy-cc-event--work">
          <header>
            <strong>{event.item.title}</strong>
            <Badge tone="neutral">{event.item.status}</Badge>
          </header>
          <p>{event.item.description}</p>
        </article>
      );
    case "multiple_departments_note":
      return (
        <article className="dfy-cc-event dfy-cc-event--departments">
          <header>
            <strong>Departamentos</strong>
          </header>
          <ul className="dfy-cc-departments">
            {event.departments.map((dept) => (
              <li key={dept.id}>
                <span>{dept.name}</span>
                <Badge tone={dept.status === "active" ? "success" : "neutral"}>
                  {dept.status === "active" ? "Activo" : "Pronto"}
                </Badge>
              </li>
            ))}
          </ul>
        </article>
      );
    case "process_event":
      return (
        <article className="dfy-cc-event dfy-cc-event--process">
          <header>
            <strong>{event.stage}</strong>
            <Badge tone={event.status === "blocked" ? "danger" : "neutral"}>
              {event.status}
            </Badge>
          </header>
          <p>{event.message}</p>
        </article>
      );
    case "transcript":
      return null;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

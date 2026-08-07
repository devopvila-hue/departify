import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import {
  api,
  type CommandCenterEvent,
  type CommandCenterMessageResult,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { readable } from "@/app/readable";
import {
  CheckIcon,
  CompanyIcon,
  DepartmentsIcon,
  PlugIcon,
  PlusIcon,
  ResultsIcon,
  SendIcon,
  SparkIcon,
  TasksIcon,
} from "@/components/icons";
import { useNavigate } from "react-router-dom";

/**
 * The Conversation — Sprint 59.
 *
 * The chat IS the application. The CEO lands here after Customer Zero.
 * The screen is dominated by the conversation; the composer is the
 * primary action.
 *
 * The first thing the CEO sees is a proactive opening from Departify
 * with a goal-grounded strategy. Subsequent turns go through the
 * Command Center router. Marketing Director V1 is invoked through
 * the existing `marketing.chat` tool when the message is delegated.
 *
 * Business events (approval requests, results, connection needs,
 * work updates) are rendered as cards INSIDE the conversation.
 * No dashboard widgets around the chat.
 */
export function ChatRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const location = useLocation();
  const [transcript, setTranscript] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [events, setEvents] = useState<readonly CommandCenterEvent[]>([]);
  const [opening, setOpening] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [processStatus, setProcessStatus] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const focusFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("focus");
  }, [location.search]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [openingData, statusData] = await Promise.all([
      api.commandCenterOpening(organizationId),
      api.status(organizationId),
    ]);
    if (openingData) setEvents(openingData.events);
    if (statusData) {
      const conv = statusData.conversation.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      }));
      setTranscript(conv);
    }
    setOpening(false);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-scroll on new messages.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [transcript, events]);

  async function send() {
    const value = input.trim();
    if (!organizationId || !value || busy) return;
    setBusy(true);
    setError(null);
    setProcessStatus("Departify está pensando…");
    setInput("");
    setTranscript((prev) => [...prev, { role: "user", content: value }]);
    const result: CommandCenterMessageResult | null =
      await api.commandCenterMessage(organizationId, value);
    setBusy(false);
    setProcessStatus(null);
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
    // Refresh the opening/proactive events from the server (the round-trip
    // may have produced new approvals, results, connection needs). The local
    // transcript is preserved because the server already has the latest
    // turn appended to session.state.conversation.
    void refreshEvents();
  }

  async function refreshEvents() {
    if (!organizationId) return;
    const openingData = await api.commandCenterOpening(organizationId);
    if (openingData) setEvents(openingData.events);
  }

  // If the URL passed a focus, prepopulate the composer (only once).
  const focusedRef = useRef(false);
  useEffect(() => {
    if (focusedRef.current) return;
    if (!focusFromUrl) return;
    if (opening) return;
    focusedRef.current = true;
    setInput(focusFromUrl);
  }, [focusFromUrl, opening]);

  return (
    <div className="dfy-chat-page">
      <div className="dfy-chat-scroller" ref={scrollerRef}>
        <ConversationList
          transcript={transcript}
          events={events}
          onNavigate={(path) => navigate(path)}
        />
        {processStatus && (
          <div className="dfy-chat-thinking" role="status">
            <SparkIcon /> {processStatus}
          </div>
        )}
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={() => void send()}
        busy={busy}
        error={error}
      />
    </div>
  );
}

function ConversationList(props: {
  transcript: { role: "user" | "assistant"; content: string }[];
  events: readonly CommandCenterEvent[];
  onNavigate: (path: string) => void;
}) {
  const { transcript, events } = props;
  if (transcript.length === 0 && events.length === 0) {
    return (
      <div className="dfy-chat-empty">
        <SparkIcon size={28} />
        <p>Aquí aparecerá tu conversación con Departify.</p>
      </div>
    );
  }

  // Interleave proactive events at the top (before the first user turn),
  // then continue with the transcript.
  return (
    <div className="dfy-thread">
      {events.length > 0 && (
        <div className="dfy-thread__opening">
          {events.map((event, index) => (
            <EventCard key={`op_${index}_${event.kind}`} event={event} onNavigate={props.onNavigate} />
          ))}
        </div>
      )}
      {transcript.map((turn, index) => (
        <div
          key={`turn_${index}`}
          className={`dfy-bubble${turn.role === "user" ? " dfy-bubble--user" : " dfy-bubble--assistant"}`}
        >
          <span className="dfy-bubble__who">
            {turn.role === "user" ? "Tú" : "Departify"}
          </span>
          <p>{turn.content}</p>
        </div>
      ))}
    </div>
  );
}

function EventCard(props: {
  event: CommandCenterEvent;
  onNavigate: (path: string) => void;
}) {
  const { event, onNavigate } = props;
  switch (event.kind) {
    case "intent_proactive":
      return (
        <article className="dfy-event dfy-event--proactive">
          <header>
            <SparkIcon className="dfy-event__icon" />
            <strong>{event.title}</strong>
          </header>
          <p>{event.message}</p>
        </article>
      );
    case "department_active":
      return (
        <article className="dfy-event dfy-event--department">
          <header>
            <DepartmentsIcon className="dfy-event__icon" />
            <strong>{event.departmentName}</strong>
            <span className="dfy-event__pill">Activo</span>
          </header>
          <p>
            {event.directorName} ({event.directorRole}) está al mando.
          </p>
          {event.team && event.team.specialists.length > 0 && (
            <ul className="dfy-event__team">
              {event.team.specialists.map((spec) => (
                <li key={spec.id}>
                  <span>{spec.name}</span>
                  <span
                    className={`dfy-event__status dfy-event__status--${spec.status}`}
                  >
                    {spec.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </article>
      );
    case "connection_need":
      return (
        <article className="dfy-event dfy-event--connection">
          <header>
            <PlugIcon className="dfy-event__icon" />
            <strong>{event.suggestion.label}</strong>
            <span className="dfy-event__pill">
              {event.suggestion.connectable ? "Por conectar" : "En preparación"}
            </span>
          </header>
          <p>{event.suggestion.why}</p>
          {event.suggestion.requiredCredentials.length > 0 && (
            <p className="dfy-event__note">
              Departify necesitará algunas credenciales en una ventana segura
              cuando decidas conectar. Nunca aparecen en el chat ni en tu
              conocimiento de empresa.
            </p>
          )}
          <button
            type="button"
            className="dfy-button dfy-button--ghost dfy-button--small"
            onClick={() => onNavigate("/conexiones")}
          >
            Gestionar conexiones
          </button>
        </article>
      );
    case "approval_request":
      return (
        <article className="dfy-event dfy-event--approval">
          <header>
            <CheckIcon className="dfy-event__icon" />
            <strong>{event.item.title}</strong>
            <span className="dfy-event__pill dfy-event__pill--warning">
              Espera tu aprobación
            </span>
          </header>
          <p>{event.proposal}</p>
          <p className="dfy-event__note">{event.detail}</p>
          <button
            type="button"
            className="dfy-button dfy-button--small"
            onClick={() => onNavigate("/aprobaciones")}
          >
            Resolver
          </button>
        </article>
      );
    case "result":
      return (
        <article className="dfy-event dfy-event--result">
          <header>
            <ResultsIcon className="dfy-event__icon" />
            <strong>{event.item.title}</strong>
            <span className="dfy-event__pill dfy-event__pill--success">Terminado</span>
          </header>
          {event.item.result && <p>{readable(event.item.result)}</p>}
          <button
            type="button"
            className="dfy-button dfy-button--ghost dfy-button--small"
            onClick={() => onNavigate("/resultados")}
          >
            Ver archivo
          </button>
        </article>
      );
    case "work_update":
      return (
        <article className="dfy-event dfy-event--work">
          <header>
            <TasksIcon className="dfy-event__icon" />
            <strong>{event.item.title}</strong>
            <span className="dfy-event__pill">{event.item.status}</span>
          </header>
          <p>{event.item.description}</p>
          <button
            type="button"
            className="dfy-button dfy-button--ghost dfy-button--small"
            onClick={() => onNavigate("/tareas")}
          >
            Ver en tareas
          </button>
        </article>
      );
    case "multiple_departments_note":
      return (
        <article className="dfy-event dfy-event--departments">
          <header>
            <DepartmentsIcon className="dfy-event__icon" />
            <strong>Departamentos</strong>
          </header>
          <ul className="dfy-event__departments">
            {event.departments.map((dept) => (
              <li key={dept.id}>
                <span>{dept.name}</span>
                <span
                  className={`dfy-event__pill ${dept.status === "active" ? "dfy-event__pill--success" : ""}`}
                >
                  {dept.status === "active" ? "Activo" : "Pronto"}
                </span>
              </li>
            ))}
          </ul>
        </article>
      );
    case "process_event":
      return (
        <article className="dfy-event dfy-event--process">
          <header>
            <strong>{event.stage}</strong>
          </header>
          <p>{event.message}</p>
        </article>
      );
    case "department_memory":
      return (
        <article className="dfy-event dfy-event--memory">
          <header>
            <DepartmentsIcon className="dfy-event__icon" />
            <strong>{event.departmentName} — memoria</strong>
            <span className="dfy-event__pill">{event.entries.length}</span>
          </header>
          <ul className="dfy-event__memory">
            {event.entries.map((entry) => (
              <li key={entry.id}>
                <span>{entry.title}</span>
                <span className="dfy-event__pill">{entry.kind}</span>
              </li>
            ))}
          </ul>
        </article>
      );
    case "dna_suggestion":
      return (
        <article className="dfy-event dfy-event--dna">
          <header>
            <CompanyIcon className="dfy-event__icon" />
            <strong>Conocimiento de empresa</strong>
            <span className="dfy-event__pill">Sugerencia</span>
          </header>
          <p>{event.suggestion.content}</p>
          <p className="dfy-event__note">
            Detectado por {event.suggestion.fromDepartment}. Esta es solo
            una propuesta: tu DNA compartido no se modifica sin tu
            aprobación.
          </p>
        </article>
      );
    case "transcript":
      return null;
  }
}

function Composer(props: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="dfy-composer-bar">
      {props.error && (
        <p className="dfy-alert" role="alert">
          {props.error}
        </p>
      )}
      <div className="dfy-composer-bar__inner">
        <button
          type="button"
          className="dfy-composer-bar__plus"
          aria-label="Adjuntar"
          disabled
        >
          <PlusIcon />
        </button>
        <textarea
          className="dfy-composer-bar__input"
          rows={1}
          placeholder="Pregunta o pide algo a tu empresa…"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              props.onSend();
            }
          }}
          disabled={props.busy}
          aria-label="Mensaje para Departify"
        />
        <button
          type="button"
          className="dfy-composer-bar__send"
          onClick={props.onSend}
          disabled={props.busy || props.value.trim().length === 0}
          aria-label="Enviar"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

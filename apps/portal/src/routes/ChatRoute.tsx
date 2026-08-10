import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import {
  api,
  type CommandCenterEvent,
  type CommandCenterMessageResult,
  type ConversationView,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { readable } from "@/app/readable";
import { renderMarkdown } from "@/app/markdown";
import {
  CheckIcon,
  CompanyIcon,
  DepartmentsIcon,
  MenuIcon,
  PlugIcon,
  PlusIcon,
  ResultsIcon,
  SendIcon,
  SparkIcon,
  TasksIcon,
} from "@/components/icons";
import { useNavigate } from "react-router-dom";

/**
 * The Conversation — Sprint 59 (Phase P-B part 15: durable sessions).
 *
 * The chat IS the application. Conversations and messages are durable and
 * organization-scoped: the CEO can start a new conversation, reopen a past
 * one, archive one, and always return to a clean chat — without losing the
 * company knowledge, connections or departments.
 */
export function ChatRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const location = useLocation();
  const [transcript, setTranscript] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [events, setEvents] = useState<readonly CommandCenterEvent[]>([]);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const loadConversation = useCallback(async (conversationId: string) => {
    const data = await api.conversation(organizationId!, conversationId);
    if (!data) return;
    setTranscript(
      data.messages.map((message) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
      })),
    );
    setCurrentConversationId(conversationId);
  }, [organizationId]);

  const refreshConversations = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.conversations(organizationId);
    if (data) setConversations(data.conversations ?? []);
  }, [organizationId]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    await refreshConversations();
    const [openingData] = await Promise.all([api.commandCenterOpening(organizationId)]);
    if (openingData) setEvents(openingData.events);
    // Reopen the most recent conversation if there is one; otherwise a clean chat.
    const data = await api.conversations(organizationId);
    const first = data?.conversations?.[0];
    if (first) {
      await loadConversation(first.id);
    } else {
      setTranscript([]);
      setCurrentConversationId(null);
    }
    setOpening(false);
  }, [organizationId, refreshConversations, loadConversation]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-scroll on new messages.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [transcript, events]);

  // Customer Zero 01 P0 — poll the work feed so a final ELVIRA
  // message appears automatically when a long analysis finishes.
  // The CEO does NOT need to send another message to recover the
  // result.
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    let lastSeen = new Date().toISOString();
    async function pollOnce() {
      if (cancelled) return;
      try {
        const feed = organizationId ? await api.workFeed(organizationId, lastSeen) : null;
        if (!feed || cancelled) return;
        if (feed.newResults.length > 0) {
          // Inject each new result as an ELVIRA turn in the transcript.
          for (const result of feed.newResults) {
            const html = renderMarkdown(result.summary + "\n\n" + result.content);
            setTranscript((prev) => {
              const exists = prev.some(
                (turn) =>
                  turn.role === "assistant" &&
                  turn.content.includes(result.title),
              );
              if (exists) return prev;
              return [
                ...prev,
                {
                  role: "assistant",
                  speaker: "elvira",
                  content: result.summary + "\n\n" + result.content,
                },
              ];
            });
            void html; // renderMarkdown is intentionally applied via the renderer below
          }
        }
        lastSeen = feed.serverTime;
      } catch {
        // polling errors are best-effort
      }
    }
    const handle = window.setInterval(pollOnce, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [organizationId]);

  async function newConversation() {
    if (!organizationId) return;
    const created = await api.createConversation(organizationId);
    if (!created?.conversation) return;
    setCurrentConversationId(created.conversation.id);
    setTranscript([]);
    setEvents([]);
    await refreshConversations();
  }

  async function archiveConversation(conversationId: string) {
    if (!organizationId) return;
    await api.archiveConversation(organizationId, conversationId);
    await refreshConversations();
    if (currentConversationId === conversationId) {
      setCurrentConversationId(null);
      setTranscript([]);
    }
  }

  async function send() {
    const value = input.trim();
    if (!organizationId || !value || busy) return;
    setBusy(true);
    setError(null);
    setProcessStatus("Departify está pensando…");
    setInput("");
    setTranscript((prev) => [...prev, { role: "user", content: value }]);
    const result: (CommandCenterMessageResult & { conversationId?: string }) | null =
      currentConversationId
        ? await api.sendConversationMessage(organizationId, currentConversationId, value)
        : await api.commandCenterMessage(organizationId, value);
    setBusy(false);
    setProcessStatus(null);
    if (!result) {
      setError(
        "Departify no ha podido responderte ahora mismo. Vuelve a intentarlo en un momento.",
      );
      return;
    }
    if (result.conversationId) setCurrentConversationId(result.conversationId);
    // The assistant reply already arrives with speaker + work-state
    // metadata in `result.events`; we surface those directly. We also
    // append the assistant message to the transcript so users see a
    // continuous conversation history.
    const speaker = inferSpeaker(result.events);
    setTranscript((prev) => [
      ...prev,
      { role: "assistant", content: result.reply, speaker },
    ]);
    setEvents(result.events);
    await refreshConversations();
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
      <div className="dfy-chat-topbar">
        <button
          type="button"
          className="dfy-chat-history-toggle"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((value) => !value)}
        >
          <MenuIcon /> Conversaciones
        </button>
        <button
          type="button"
          className="dfy-chat-new"
          onClick={() => void newConversation()}
        >
          <PlusIcon /> Nueva conversación
        </button>
      </div>

      {historyOpen && (
        <div className="dfy-chat-history" aria-label="Conversaciones recientes">
          {conversations.length === 0 ? (
            <p className="dfy-muted">Todavía no tienes conversaciones.</p>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`dfy-chat-history__row${conversation.id === currentConversationId ? " dfy-chat-history__row--active" : ""}`}
              >
                <button
                  type="button"
                  className="dfy-chat-history__open"
                  onClick={() => void loadConversation(conversation.id)}
                >
                  {conversation.title}
                </button>
                <button
                  type="button"
                  className="dfy-chat-history__archive"
                  aria-label={`Archivar ${conversation.title}`}
                  onClick={() => void archiveConversation(conversation.id)}
                >
                  Archivar
                </button>
              </div>
            ))
          )}
        </div>
      )}

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
  transcript: {
    role: "user" | "assistant";
    content: string;
    speaker?: "departify" | "elvira";
  }[];
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

  return (
    <div className="dfy-thread">
      {transcript.map((turn, index) => {
        const speakerLabel = turn.role === "user"
          ? "Tú"
          : turn.speaker === "elvira"
            ? "ELVIRA · Directora de Marketing"
            : "DEPARTIFY";
        const html = renderMarkdown(turn.content);
        return (
          <div
            key={`turn_${index}`}
            className={`dfy-bubble${turn.role === "user" ? " dfy-bubble--user" : " dfy-bubble--assistant"}`}
            data-speaker={turn.speaker ?? "departify"}
          >
            <span className="dfy-bubble__who">{speakerLabel}</span>
            <div
              className="dfy-bubble__body"
              // The Markdown renderer escapes all input and only emits
              // a fixed tag whitelist (p, ul, ol, li, strong, em, code, a).
              // See apps/portal/src/app/markdown.ts.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        );
      })}
      {events.length > 0 && (
        <div className="dfy-thread__opening">
          {events.map((event, index) => (
            <EventCard
              key={`op_${index}_${event.kind}_${String((event as { state?: string }).state ?? index)}`}
              event={event}
              onNavigate={props.onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function inferSpeaker(events: readonly CommandCenterEvent[]): "departify" | "elvira" {
  for (const event of events) {
    if (event.kind === "transcript" && event.speaker) return event.speaker;
  }
  return "departify";
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
    case "work_state":
      return (
        <article
          className="dfy-event dfy-event--work-state"
          data-state={event.state}
          aria-live="polite"
        >
          <span className="dfy-event__pill" aria-hidden="true">
            <SparkIcon size={14} />
          </span>
          <span>{event.message}</span>
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

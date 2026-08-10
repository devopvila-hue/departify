import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  api,
  type CommandCenterEvent,
  type CommandCenterMessageResult,
  type ConversationView,
  type MaxActiveConversationsError,
  type MessageView,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
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

/**
 * The Conversation — Sprint 60 (Phase P-B part 15 + 26).
 *
 * Behaviour:
 *   - The chat IS the application.
 *   - Maximum 5 ACTIVE conversations. The 6th request opens a confirm
 *     dialog: archive one to continue, or cancel. No silent deletes.
 *   - Each conversation is durable server-side (Supabase) so a reload,
 *     a backend restart, or a deploy preserves everything.
 *   - Switching conversations reloads the recent transcript and scrolls
 *     to the latest turn. Composer stays ready.
 *   - New conversation: opens at first user input, not embedded in a
 *     dashboard. Empty start shows a single grounded opening prompt.
 *   - Long transcripts compact internally (deterministic summary). The
 *     CEO sees ONE continuous conversation. The portal surfaces a
 *     subtle hint when a compaction has run.
 *   - Conversation titles default to "Nueva conversación" until enough
 *     context exists; the backend derives a useful title without making
 *     the user wait.
 *   - Archived conversations remain visible from history and never
 *     count toward the 5-active cap. History does not delete memory.
 */
export function ChatRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const location = useLocation();
  const [transcript, setTranscript] = useState<
    { role: "user" | "assistant"; content: string; speaker?: "departify" | "elvira" }[]
  >([]);
  const [events, setEvents] = useState<readonly CommandCenterEvent[]>([]);
  const [conversations, setConversations] = useState<ConversationView[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<
    ConversationView[]
  >([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [currentSummary, setCurrentSummary] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [opening, setOpening] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [processStatus, setProcessStatus] = useState<string | null>(null);
  const [maxActive, setMaxActive] = useState(5);
  const [capDialog, setCapDialog] = useState<{
    open: boolean;
    activeCount: number;
    maxActive: number;
  }>({ open: false, activeCount: 0, maxActive: 5 });
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const focusFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("focus");
  }, [location.search]);

  const refreshConversations = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.conversations(organizationId);
    if (data) {
      setConversations(data.conversations ?? []);
      setMaxActive(data.maxActive ?? 5);
    }
    const history = await api.conversationHistory(organizationId);
    if (history) {
      setArchivedConversations(
        (history.conversations ?? []).filter((c) => c.status === "archived"),
      );
    }
  }, [organizationId]);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      const data = await api.conversation(organizationId!, conversationId);
      if (!data) return;
      setTranscript(
        data.messages.map((message: MessageView) => ({
          role: message.role,
          content: message.content,
        })),
      );
      setCurrentConversationId(conversationId);
      setCurrentSummary(data.conversation.summary ?? null);
      setHistoryOpen(false);
    },
    [organizationId],
  );

  const load = useCallback(async () => {
    if (!organizationId) return;
    await refreshConversations();
    const openingData = await api.commandCenterOpening(organizationId);
    if (openingData) setEvents(filterContextualEvents(openingData.events));

    const data = await api.conversations(organizationId);
    const first = data?.conversations?.[0];
    if (first) {
      await loadConversation(first.id);
    } else {
      setTranscript([]);
      setCurrentConversationId(null);
      setCurrentSummary(null);
    }
    setOpening(false);
  }, [organizationId, refreshConversations, loadConversation]);

  useEffect(() => {
    void load();
  }, [load]);

  // Central Chat UX P0 — auto-scroll that respects the CEO's manual
  // scroll position. Three independent triggers:
  //   1. New send → snap to bottom (forced).
  //   2. New assistant turn/event (passive) → only auto-follow if the
  //      CEO is near the bottom; if they scrolled up, preserve their
  //      position and surface a "Ir al último mensaje" affordance.
  //   3. Conversation switch → snap to bottom.
  const stickToBottomRef = useRef(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [followRequested, setFollowRequested] = useState(false);

  // Observe whether the CEO is near the bottom of the transcript.
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    function onScroll() {
      const el = node;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      // < 80px from the bottom counts as "near".
      stickToBottomRef.current = distance < 80;
    }
    node.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  // Force scroll on send OR when the user clicks "Ir al último mensaje".
  useEffect(() => {
    if (!followRequested) return;
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setFollowRequested(false);
  }, [followRequested, transcript, events]);

  // Auto-follow passive updates only while the CEO is near the bottom.
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [transcript, events]);

  // Customer Zero 01 P0 — poll the work feed so a final ELVIRA
  // message appears automatically when a long analysis finishes.
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    let lastSeen = new Date().toISOString();
    async function pollOnce() {
      if (cancelled) return;
      try {
        const feed = organizationId
          ? await api.workFeed(organizationId, lastSeen)
          : null;
        if (!feed || cancelled) return;
        if (feed.newResults.length > 0) {
          for (const result of feed.newResults) {
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
    setError(null);
    const result = await api.createConversation(organizationId);
    if (!result || !result.conversation) {
      setError(
        "Departify no ha podido abrir una nueva conversación. Inténtalo de nuevo.",
      );
      return;
    }
    if (result.error && result.error.code === "MAX_ACTIVE_CONVERSATIONS") {
      setCapDialog({
        open: true,
        activeCount: result.error.activeCount,
        maxActive: result.error.maxActive,
      });
      return;
    }
    setCurrentConversationId(result.conversation.id);
    setCurrentSummary(null);
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
      setCurrentSummary(null);
    }
  }

  async function resumeArchived(conversationId: string) {
    await loadConversation(conversationId);
    // The previously-archived conversation becomes active again because
    // a new CEO message re-opens it. We rely on the backend list
    // refresh to update the sidebar.
    await refreshConversations();
  }

  async function send() {
    const value = input.trim();
    if (!organizationId || !value || busy) return;
    setBusy(true);
    setError(null);
    setProcessStatus("Departify está pensando…");
    setInput("");
    // Sending a new message always returns focus to the latest exchange,
    // even if the CEO was reading older history. Distinct from passive
    // updates, which respect the manual scroll override.
    setFollowRequested(true);

    // When no conversation is active, route through the same backend
    // endpoint that auto-creates the durable conversation on first use.
    // The 5-active-cap is enforced by the same endpoint via
    // ensureConversation (see customer-zero-v2.ts). When a conversation
    // is already selected, send the message to that conversation.
    const result: (CommandCenterMessageResult & {
      conversationId?: string;
      error?: MaxActiveConversationsError;
    }) | null = currentConversationId
      ? await api.sendConversationMessage(
          organizationId,
          currentConversationId,
          value,
        )
      : await api.commandCenterMessage(organizationId, value);
    setBusy(false);
    setProcessStatus(null);
    if (!result) {
      setError(
        "Departify no ha podido responderte ahora mismo. Vuelve a intentarlo en un momento.",
      );
      return;
    }
    if (
      result.error &&
      result.error.code === "MAX_ACTIVE_CONVERSATIONS"
    ) {
      setCapDialog({
        open: true,
        activeCount: result.error.activeCount,
        maxActive: result.error.maxActive,
      });
      return;
    }
    // Central Chat UX P0 — only the assistant reply is appended. The
    // connection_need / process_event cards from the proactive opening
    // payload are filtered out so they don't pollute the visible
    // transcript after every send.
    const cleanEvents = [...filterContextualEvents(result.events)];
    // Contextual connection cards DO still render, but only when they
    // are genuinely tied to THIS turn: the routing produced a
    // connectionSuggestion because the CEO mentioned the tool or the
    // current task needs it. Unrelated cards from the opening are gone.
    if (result.connectionSuggestion) {
      cleanEvents.push({
        kind: "connection_need",
        suggestion: result.connectionSuggestion,
      });
    }
    // Append both the optimistic user line and the assistant reply so the
    // CEO sees their own message immediately and a continuous history.
    setTranscript((prev) => [
      ...prev,
      { role: "user", content: value },
      { role: "assistant", content: result!.reply, speaker: inferSpeaker(cleanEvents) },
    ]);
    setEvents(cleanEvents);
    if (result.conversationId) setCurrentConversationId(result.conversationId);
    await refreshConversations();
  }

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
          data-testid="chat-new"
          onClick={() => void newConversation()}
          disabled={opening}
        >
          <PlusIcon /> Nueva conversación
        </button>
      </div>

      {historyOpen && (
        <div className="dfy-chat-history" aria-label="Conversaciones recientes">
          <p className="dfy-chat-history__count">
            {conversations.length} activas de un máximo de {maxActive}
          </p>
          {conversations.length === 0 ? (
            <p className="dfy-muted">Todavía no tienes conversaciones.</p>
          ) : (
            conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`dfy-chat-history__row${
                  conversation.id === currentConversationId
                    ? " dfy-chat-history__row--active"
                    : ""
                }`}
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
          {archivedConversations.length > 0 && (
            <div className="dfy-chat-history__archived">
              <p className="dfy-chat-history__archived-title">Archivadas</p>
              {archivedConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className="dfy-chat-history__archived-row"
                  onClick={() => void resumeArchived(conversation.id)}
                >
                  {conversation.title}{" "}
                  <span className="dfy-muted dfy-muted--small">
                    (recuperable)
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {currentSummary && (
        <div
          className="dfy-chat-summary-hint"
          aria-label="Resumen compacto de la conversación"
          data-testid="chat-summary"
        >
          <SparkIcon /> Conversación larga — Departify recuerda el contexto
          automáticamente.
        </div>
      )}

      <div
        className="dfy-chat-scroller"
        ref={scrollerRef}
        data-testid="chat-scroller"
      >
        <ConversationList
          transcript={transcript}
          events={events}
          isFresh={transcript.length === 0 && events.length === 0 && !opening}
          onNavigate={(path) => navigate(path)}
        />
        {processStatus && (
          <div className="dfy-chat-thinking" role="status">
            <SparkIcon /> {processStatus}
          </div>
        )}
        {!stickToBottomRef.current && (transcript.length > 0 || events.length > 0) && (
          <button
            type="button"
            className="dfy-chat-jump-latest"
            data-testid="chat-jump-latest"
            onClick={() => {
              setFollowRequested(true);
              stickToBottomRef.current = true;
            }}
            aria-label="Ir al último mensaje"
          >
            ↓ Ir al último mensaje
          </button>
        )}
        <div ref={sentinelRef} aria-hidden="true" />
      </div>

      <Composer
        value={input}
        onChange={setInput}
        onSend={() => void send()}
        busy={busy}
        error={error}
      />

      {capDialog.open && (
        <ArchiveCapDialog
          activeCount={capDialog.activeCount}
          maxActive={capDialog.maxActive}
          conversations={conversations}
          onArchive={async (conversationId) => {
            await archiveConversation(conversationId);
            setCapDialog({ open: false, activeCount: 0, maxActive: 5 });
            // After archiving, retry the new-conversation creation
            // automatically. This keeps the CEO's click → result path
            // simple.
            await newConversation();
          }}
          onCancel={() =>
            setCapDialog({ open: false, activeCount: 0, maxActive: 5 })
          }
        />
      )}
    </div>
  );
}

function ArchiveCapDialog(props: {
  activeCount: number;
  maxActive: number;
  conversations: ConversationView[];
  onArchive: (conversationId: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  return (
    <div className="dfy-cap-dialog__backdrop" role="dialog" aria-modal="true">
      <div className="dfy-cap-dialog">
        <h2>Ya tienes {props.activeCount} conversaciones activas</h2>
        <p>
          Para abrir una nueva, archiva una de las existentes. Tu historial
          nunca se pierde.
        </p>
        <ul className="dfy-cap-dialog__list">
          {props.conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => void props.onArchive(conversation.id)}
                className="dfy-button dfy-button--small"
              >
                Archivar «{conversation.title}»
              </button>
            </li>
          ))}
        </ul>
        <div className="dfy-cap-dialog__actions">
          <button
            type="button"
            className="dfy-button dfy-button--ghost"
            onClick={props.onCancel}
          >
            Cancelar
          </button>
        </div>
      </div>
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
  isFresh: boolean;
  onNavigate: (path: string) => void;
}) {
  const { transcript, events, isFresh, onNavigate } = props;
  if (transcript.length === 0 && events.length === 0) {
    if (isFresh) {
      return (
        <div className="dfy-chat-empty" data-testid="chat-empty">
          <SparkIcon size={28} />
          <h2>¿Qué quieres conseguir?</h2>
          <p>Escribe algo a tu empresa. Departify se encarga del resto.</p>
        </div>
      );
    }
    return (
      <div className="dfy-chat-empty">
        <SparkIcon size={28} />
        <p>Aqui aparecerá tu conversación con Departify.</p>
      </div>
    );
  }

  return (
    <div className="dfy-thread">
      {transcript.map((turn, index) => {
        const speakerLabel =
          turn.role === "user"
            ? "Tú"
            : turn.speaker === "elvira"
              ? "ELVIRA · Directora de Marketing"
              : "DEPARTIFY";
        const html = renderMarkdown(turn.content);
        return (
          <div
            key={`turn_${index}_${turn.role}`}
            className={`dfy-bubble${
              turn.role === "user" ? " dfy-bubble--user" : " dfy-bubble--assistant"
            }`}
            data-speaker={turn.speaker ?? "departify"}
          >
            <span className="dfy-bubble__who">{speakerLabel}</span>
            <div
              className="dfy-bubble__body"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        );
      })}
      {events.length > 0 && (
        <div className="dfy-thread__opening">
          {events.map((event, index) => (
            <EventCard
              key={`op_${index}_${event.kind}_${String(
                (event as { state?: string }).state ?? index,
              )}`}
              event={event}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function inferSpeaker(
  events: readonly CommandCenterEvent[],
): "departify" | "elvira" {
  for (const event of events) {
    if (event.kind === "transcript" && event.speaker) return event.speaker;
  }
  return "departify";
}

/**
 * Central Chat UX P0 — filter the events that may render inside the
 * visible transcript. Keep only the contextual events tied to the
 * current turn; drop the proactive opening cards and the transient
 * work-state pill (shown once via `processStatus`, not as a durable
 * bubble).
 */
function filterContextualEvents(
  events: readonly CommandCenterEvent[],
): readonly CommandCenterEvent[] {
  return events.filter((event) => {
    if (event.kind === "process_event") return false;
    if (event.kind === "work_state") return false;
    if (event.kind === "connection_need") return false;
    if (event.kind === "multiple_departments_note") return false;
    return true;
  });
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
          {event.item.result && <p>{event.item.result}</p>}
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
                  className={`dfy-event__pill ${
                    dept.status === "active" ? "dfy-event__pill--success" : ""
                  }`}
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

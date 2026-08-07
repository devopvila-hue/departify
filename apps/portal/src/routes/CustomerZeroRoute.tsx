import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

/**
 * Customer Zero — UX v2.
 *
 * The CEO explains what he wants to achieve; Departify learns, works
 * visibly, asks only what it cannot know, offers the connections it needs
 * inside the conversation, and hands over to Marketing with continuity.
 * The complexity belongs to the system, never to the user.
 */

export interface InterpretedBusiness {
  companyName?: string;
  activity?: string;
  mission?: string;
  products?: string[];
  services?: string[];
  market?: string;
  positioning?: string;
  targetAudience?: string[];
  tone?: string[];
  locations?: string[];
  valueProposition?: string;
}

export interface ResearchStage {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  finding?: string;
}

export interface ProgressResponse {
  organizationId: string;
  status: "running" | "completed" | "failed";
  stages: ResearchStage[];
  estimatedMs: number | null;
  error?: string;
  gapCount?: number;
  understood: InterpretedBusiness;
}

export interface ProgressiveQuestion {
  id: string;
  kind: "dna" | "tools" | "crm" | "tool_detail";
  category?: string;
  question: string;
  component: "text" | "choice" | "multi_choice";
  options?: string[];
  weight: "blocking" | "useful" | "optional";
  hint?: string;
}

export interface ConnectionCard {
  toolId: string;
  label: string;
  capability: string;
  category: string;
  status: "not_connected" | "connecting" | "connected" | "blocked";
  blockedReason?: string;
  missingCredentials?: string[];
  authorizationUrl?: string;
}

export interface ConversationResponse {
  organizationId: string;
  question: ProgressiveQuestion | null;
  ready: boolean;
  gapCount: number;
  connections: ConnectionCard[];
  transcript: { questionId: string; question: string; answer: string }[];
  intro: string;
  handoff?: string;
  gapsResolved?: number;
}

export interface DepartmentSurface {
  id: string;
  name: string;
  description: string;
  directorAgentId: string | null;
  employeeAgentIds: string[];
  status: string;
  connections: { kind: string; referenceId: string; label?: string }[];
  discoveryId?: string;
}

export interface PrepareMarketingResponse {
  organizationId: string;
  department: DepartmentSurface | null;
  firstResult: Record<string, unknown> | null;
  gaps: unknown[];
  questions: unknown[];
  error: { code: string; message: string } | null;
}

export interface MarketingWorkItem {
  id: string;
  title: string;
  description: string;
  kind: string;
  capability?: string;
  status?: string;
  result?: string;
}

export interface MarketingWorkState {
  goal: string;
  summary: string;
  items: MarketingWorkItem[];
}

type Step =
  | { name: "intake" }
  | { name: "researching"; org: string }
  | { name: "conversation"; org: string }
  | { name: "marketing"; org: string; surface: PrepareMarketingResponse };

const GOAL_OPTIONS = [
  "Conseguir clientes",
  "Vender más",
  "Dar a conocer mi empresa",
  "Lanzar mi negocio",
  "Ahorrar tiempo",
  "Otro",
];

const SIZE_OPTIONS = ["Solo yo", "2-10", "11-50", "51-200", "Más de 200"];

export function CustomerZeroRoute() {
  const [step, setStep] = useState<Step>({ name: "intake" });
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationResponse | null>(null);
  const [handoff, setHandoff] = useState<string>("");
  const [work, setWork] = useState<MarketingWorkState | null>(null);
  const [workBusy, setWorkBusy] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // Resume after a reload: DNA, objetivo, respuestas, herramientas y Marketing.
  useEffect(() => {
    const stored = window.localStorage.getItem("departify_customer_zero");
    if (!stored) return;
    let parsed: { organizationId: string };
    try {
      parsed = JSON.parse(stored) as { organizationId: string };
    } catch {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/customer-zero/${parsed.organizationId}`);
        if (!response.ok) return;
        const status = (await response.json()) as {
          organizationId: string;
          department: DepartmentSurface | null;
          marketingWork?: MarketingWorkState | null;
          conversation: { role: string; content: string }[];
        };
        if (cancelled) return;
        setMessages(status.conversation ?? []);
        if (status.marketingWork) setWork(status.marketingWork);
        if (status.department) {
          setStep({
            name: "marketing",
            org: status.organizationId,
            surface: {
              organizationId: status.organizationId,
              department: status.department,
              firstResult: null,
              gaps: [],
              questions: [],
              error: null,
            },
          });
          return;
        }
        const next = await fetch(
          `/api/customer-zero/${parsed.organizationId}/next-question`,
        );
        if (next.ok && !cancelled) {
          setConversation((await next.json()) as ConversationResponse);
          setStep({ name: "conversation", org: parsed.organizationId });
        }
      } catch {
        /* resume is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function persistSession(organizationId: string) {
    try {
      window.localStorage.setItem(
        "departify_customer_zero",
        JSON.stringify({ organizationId }),
      );
    } catch {
      /* localStorage unavailable */
    }
  }

  const loadConversation = useCallback(async (org: string) => {
    const response = await fetch(`/api/customer-zero/${org}/next-question`);
    if (!response.ok) return;
    const body = (await response.json()) as ConversationResponse;
    setConversation(body);
    if (body.handoff) setHandoff(body.handoff);
    setStep({ name: "conversation", org });
  }, []);

  async function startOnboarding(payload: Record<string, unknown>) {
    setError(null);
    try {
      const response = await fetch("/api/customer-zero/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, locale: uiLocale() }),
      });
      const body = (await response.json()) as {
        organizationId?: string;
        error?: { message: string };
      };
      if (!response.ok || !body.organizationId) {
        setError(body.error?.message ?? `Error ${response.status}`);
        return;
      }
      persistSession(body.organizationId);
      setStep({ name: "researching", org: body.organizationId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function answerQuestion(
    org: string,
    questionId: string,
    answers: string[],
  ) {
    setError(null);
    try {
      const response = await fetch(`/api/customer-zero/${org}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId, answers }),
      });
      if (!response.ok) {
        setError(`Error ${response.status}`);
        return;
      }
      const body = (await response.json()) as ConversationResponse;
      setConversation(body);
      if (body.handoff) setHandoff(body.handoff);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function connectTool(org: string, toolId: string) {
    setError(null);
    try {
      const response = await fetch(
        `/api/customer-zero/${org}/connections/${toolId}/connect`,
        { method: "POST" },
      );
      const body = (await response.json()) as { connection?: ConnectionCard };
      if (!body.connection) return;
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              connections: prev.connections.map((connection) =>
                connection.toolId === toolId ? body.connection! : connection,
              ),
            }
          : prev,
      );
      if (body.connection.authorizationUrl) {
        window.open(body.connection.authorizationUrl, "_blank", "noopener");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function prepareMarketing(org: string) {
    setError(null);
    try {
      const response = await fetch(`/api/customer-zero/${org}/marketing`, {
        method: "POST",
      });
      const body = (await response.json()) as PrepareMarketingResponse;
      if (!response.ok) {
        setError(`Error ${response.status}`);
        return;
      }
      const handoffResponse = await fetch(`/api/customer-zero/${org}/handoff`);
      if (handoffResponse.ok) {
        const handoffBody = (await handoffResponse.json()) as {
          message: string;
          goal: string;
        };
        setHandoff(handoffBody.message);
        setMessages([{ role: "assistant", content: handoffBody.message }]);
        if (handoffBody.goal) setGoalInput(handoffBody.goal);
      }
      setStep({ name: "marketing", org, surface: body });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function giveGoal(org: string) {
    const goal = goalInput.trim();
    if (!goal || workBusy) return;
    setWorkBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/customer-zero/${org}/marketing/work`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const body = (await response.json()) as {
        summary: string;
        items: MarketingWorkItem[];
        error?: { message: string };
      };
      if (!response.ok || body.error) {
        setError(body.error?.message ?? `Error ${response.status}`);
        return;
      }
      setWork({
        goal,
        summary: body.summary,
        items: body.items.map((item) => ({
          ...item,
          status: item.kind === "external_action" ? "needs_approval" : "pending",
        })),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorkBusy(false);
    }
  }

  async function itemAction(org: string, itemId: string, action: string) {
    setWorkBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/customer-zero/${org}/marketing/work/${itemId}/${action}`,
        { method: "POST" },
      );
      const body = (await response.json()) as {
        status: string;
        result: string;
        error?: { message: string };
      };
      if (!response.ok || body.error) {
        setError(body.error?.message ?? `Error ${response.status}`);
        return;
      }
      setWork((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) =>
                item.id === itemId
                  ? { ...item, status: body.status, result: body.result }
                  : item,
              ),
            }
          : prev,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorkBusy(false);
    }
  }

  async function sendMessage(org: string) {
    const content = chatInput.trim();
    if (!content || chatBusy) return;
    setChatBusy(true);
    setMessages((prev) => [...prev, { role: "user", content }]);
    setChatInput("");
    try {
      const response = await fetch(`/api/customer-zero/${org}/marketing/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: content }),
      });
      const body = (await response.json()) as {
        reply?: string;
        error?: { message: string };
      };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: body.reply ?? `Error: ${body.error?.message ?? response.status}`,
        },
      ]);
    } catch (cause) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: cause instanceof Error ? cause.message : String(cause) },
      ]);
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <main className="customer-zero" aria-labelledby="customer-zero-title">
      <section className="customer-zero__panel">
        <p className="customer-zero__label">Departify</p>
        <h1 id="customer-zero-title">
          {step.name === "intake" && "Cuéntame lo mínimo sobre tu empresa"}
          {step.name === "researching" && "Conociendo tu negocio…"}
          {step.name === "conversation" && "Solo un par de cosas más"}
          {step.name === "marketing" && "Departamento de Marketing"}
        </h1>

        {error && (
          <div className="customer-zero__state customer-zero__state--error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {step.name === "intake" && <IntakeStep onStart={startOnboarding} />}

        {step.name === "researching" && (
          <ResearchStep
            org={step.org}
            onDone={() => loadConversation(step.org)}
            onFail={(message) => {
              setError(message);
              setStep({ name: "intake" });
            }}
          />
        )}

        {step.name === "conversation" && conversation && (
          <ConversationStep
            conversation={conversation}
            handoff={handoff}
            onAnswer={(questionId, answers) =>
              answerQuestion(step.org, questionId, answers)
            }
            onConnect={(toolId) => connectTool(step.org, toolId)}
            onStartMarketing={() => prepareMarketing(step.org)}
          />
        )}

        {step.name === "marketing" && (
          <MarketingStep
            surface={step.surface}
            handoff={handoff}
            work={work}
            workBusy={workBusy}
            goalInput={goalInput}
            onGoalInput={setGoalInput}
            onGiveGoal={() => giveGoal(step.org)}
            onExecuteItem={(itemId) => itemAction(step.org, itemId, "execute")}
            onApproveItem={(itemId) => itemAction(step.org, itemId, "approve")}
            messages={messages}
            busy={chatBusy}
            input={chatInput}
            onInput={setChatInput}
            onSend={() => sendMessage(step.org)}
          />
        )}
      </section>
    </main>
  );
}

function uiLocale(): string {
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  return "es";
}

/** Fase 2 — the minimum high-value information, one decision at a time. */
function IntakeStep(props: {
  onStart: (payload: Record<string, unknown>) => void;
}) {
  const [companyName, setCompanyName] = useState("");
  const [hasWebsite, setHasWebsite] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [country, setCountry] = useState("");
  const [companySize, setCompanySize] = useState("");
  const [goal, setGoal] = useState("");
  const [goalDetail, setGoalDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const ready =
    companyName.trim().length > 0 &&
    (hasWebsite === true
      ? url.trim().length > 0
      : hasWebsite === false
        ? description.trim().length > 0
        : false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    props.onStart({
      companyName: companyName.trim(),
      hasWebsite: hasWebsite === true,
      ...(hasWebsite ? { url: url.trim() } : { description: description.trim() }),
      ...(country ? { country } : {}),
      ...(companySize ? { companySize } : {}),
      ...(goal ? { goal } : {}),
      ...(goalDetail ? { goalDetail: goalDetail.trim() } : {}),
    });
  }

  return (
    <form onSubmit={submit} className="customer-zero__form">
      <label className="customer-zero__field">
        <span>¿Cómo se llama tu empresa?</span>
        <input
          type="text"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          placeholder="MOON Shared Living"
          required
        />
      </label>

      <fieldset className="customer-zero__choice-group">
        <legend>¿Tienes página web?</legend>
        <div className="customer-zero__choices">
          <button
            type="button"
            className={`customer-zero__chip${hasWebsite === true ? " customer-zero__chip--selected" : ""}`}
            onClick={() => setHasWebsite(true)}
          >
            Tengo página web
          </button>
          <button
            type="button"
            className={`customer-zero__chip${hasWebsite === false ? " customer-zero__chip--selected" : ""}`}
            onClick={() => setHasWebsite(false)}
          >
            Estoy empezando / No tengo web
          </button>
        </div>
      </fieldset>

      {hasWebsite === true && (
        <label className="customer-zero__field">
          <span>Página web</span>
          <input
            type="text"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="miempresa.com"
          />
        </label>
      )}

      {hasWebsite === false && (
        <label className="customer-zero__field">
          <span>Cuéntanos qué estás creando</span>
          <textarea
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Estoy creando una plataforma que ayuda a personas a encontrar vivienda compartida compatible y segura."
          />
        </label>
      )}

      <label className="customer-zero__field">
        <span>País principal</span>
        <input
          type="text"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          placeholder="España"
        />
      </label>

      <fieldset className="customer-zero__choice-group">
        <legend>¿Cuántos sois?</legend>
        <div className="customer-zero__choices">
          {SIZE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`customer-zero__chip${companySize === option ? " customer-zero__chip--selected" : ""}`}
              onClick={() => setCompanySize(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="customer-zero__choice-group">
        <legend>¿Qué quieres conseguir ahora?</legend>
        <div className="customer-zero__choices">
          {GOAL_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={`customer-zero__chip${goal === option ? " customer-zero__chip--selected" : ""}`}
              onClick={() => setGoal(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="customer-zero__field">
        <span>Cuéntamelo con tus palabras (opcional)</span>
        <input
          type="text"
          value={goalDetail}
          onChange={(event) => setGoalDetail(event.target.value)}
          placeholder="Quiero conseguir los primeros 20 clientes en España."
        />
      </label>

      <button type="submit" className="customer-zero__submit" disabled={!ready || busy}>
        {busy ? "Empezando…" : "Empezar"}
      </button>
    </form>
  );
}

/** Fase 3 — the live research screen driven by the REAL pipeline stages. */
function ResearchStep(props: {
  org: string;
  onDone: () => void;
  onFail: (message: string) => void;
}) {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const done = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/customer-zero/${props.org}/progress`);
        if (!response.ok) return;
        const body = (await response.json()) as ProgressResponse;
        if (cancelled) return;
        setProgress(body);
        if (body.status === "completed" && !done.current) {
          done.current = true;
          props.onDone();
        }
        if (body.status === "failed" && !done.current) {
          done.current = true;
          props.onFail(body.error ?? "No hemos podido analizar tu negocio.");
        }
      } catch {
        /* keep polling */
      }
    }, 700);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [props]);

  const estimate = progress?.estimatedMs ?? null;

  return (
    <div className="customer-zero__state" role="status" aria-live="polite">
      <p>Departify está trabajando en tu negocio.</p>
      {estimate !== null && (
        <p className="customer-zero__state-hint">
          Normalmente tarda menos de {Math.max(1, Math.round(estimate / 1000))}{" "}
          segundos.
        </p>
      )}
      <ul className="customer-zero__stages">
        {(progress?.stages ?? []).map((stage) => (
          <li
            key={stage.id}
            className={`customer-zero__stage customer-zero__stage--${stage.status}`}
          >
            <span className="customer-zero__stage-icon" aria-hidden="true">
              {stage.status === "done" ? "✓" : stage.status === "running" ? "→" : "○"}
            </span>
            <span>
              {stage.label}
              {stage.finding && (
                <em className="customer-zero__stage-finding">{stage.finding}</em>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Fases 5-9 — one question at a time, with connection cards in the chat. */
function ConversationStep(props: {
  conversation: ConversationResponse;
  handoff: string;
  onAnswer: (questionId: string, answers: string[]) => void;
  onConnect: (toolId: string) => void;
  onStartMarketing: () => void;
}) {
  const { conversation } = props;
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const question = conversation.question;

  useEffect(() => {
    setText("");
    setSelected([]);
  }, [question?.id]);

  function toggle(option: string) {
    setSelected((prev) =>
      prev.includes(option)
        ? prev.filter((item) => item !== option)
        : [...prev, option],
    );
  }

  return (
    <>
      <p className="customer-zero__intro">{conversation.intro}</p>

      {conversation.transcript.length > 0 && (
        <div className="customer-zero__chat">
          {conversation.transcript.map((turn) => (
            <div key={turn.questionId} className="customer-zero__chat-message">
              <strong>Departify</strong>
              <p>{turn.question}</p>
              <p className="customer-zero__muted">Tú: {turn.answer}</p>
            </div>
          ))}
        </div>
      )}

      {conversation.connections.length > 0 && (
        <div className="customer-zero__cards">
          {conversation.connections.map((connection) => (
            <article key={connection.toolId} className="customer-zero__card">
              <header>
                <strong>{connection.label}</strong>
                <span className="customer-zero__muted">{connection.category}</span>
              </header>
              <p
                className={`customer-zero__badge customer-zero__badge--${connection.status}`}
              >
                {connectionLabel(connection)}
              </p>
              {connection.status !== "connected" && (
                <button
                  type="button"
                  className="customer-zero__submit customer-zero__submit--small"
                  onClick={() => props.onConnect(connection.toolId)}
                >
                  Conectar {connection.label}
                </button>
              )}
              {connection.status === "blocked" && connection.blockedReason && (
                <p className="customer-zero__muted">{connection.blockedReason}</p>
              )}
            </article>
          ))}
        </div>
      )}

      {question ? (
        <div className="customer-zero__question">
          <h2 className="customer-zero__section">{question.question}</h2>
          {question.hint && <p className="customer-zero__muted">{question.hint}</p>}

          {question.component === "text" && (
            <div className="customer-zero__chat-input">
              <input
                type="text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && text.trim()) {
                    props.onAnswer(question.id, [text.trim()]);
                  }
                }}
                placeholder="Escribe tu respuesta…"
              />
              <button
                type="button"
                onClick={() => props.onAnswer(question.id, [text.trim()])}
                disabled={text.trim().length === 0}
              >
                Responder
              </button>
            </div>
          )}

          {question.component === "choice" && (
            <div className="customer-zero__choices">
              {(question.options ?? []).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="customer-zero__chip"
                  onClick={() => props.onAnswer(question.id, [option])}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {question.component === "multi_choice" && (
            <>
              <div className="customer-zero__choices">
                {(question.options ?? []).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`customer-zero__chip${selected.includes(option) ? " customer-zero__chip--selected" : ""}`}
                    onClick={() => toggle(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="customer-zero__submit"
                disabled={selected.length === 0}
                onClick={() => props.onAnswer(question.id, selected)}
              >
                Continuar
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="customer-zero__review">
          <h2>Ya tengo suficiente</h2>
          <p className="customer-zero__muted">
            {props.handoff || conversation.handoff}
          </p>
          <button
            type="button"
            className="customer-zero__submit"
            onClick={props.onStartMarketing}
          >
            Vamos a trabajar
          </button>
        </div>
      )}
    </>
  );
}

function connectionLabel(connection: ConnectionCard): string {
  switch (connection.status) {
    case "connected":
      return "✓ Conectado";
    case "connecting":
      return "Conectando…";
    case "blocked":
      return "Todavía no disponible";
    default:
      return "○ No conectado";
  }
}

function MarketingStep(props: {
  surface: PrepareMarketingResponse;
  handoff: string;
  work: MarketingWorkState | null;
  workBusy: boolean;
  goalInput: string;
  onGoalInput: (value: string) => void;
  onGiveGoal: () => void;
  onExecuteItem: (itemId: string) => void;
  onApproveItem: (itemId: string) => void;
  messages: { role: string; content: string }[];
  busy: boolean;
  input: string;
  onInput: (value: string) => void;
  onSend: () => void;
}) {
  const dept = props.surface.department;
  return (
    <>
      <p className="customer-zero__intro">
        {props.surface.error ? (
          <span className="customer-zero__state--error">
            El Departamento no pudo prepararse: {props.surface.error.message}
          </span>
        ) : (
          props.handoff || "Marketing ya conoce tu negocio."
        )}
      </p>

      {dept && (
        <div className="customer-zero__review">
          <h2>{dept.name}</h2>
          <dl>
            <div>
              <dt>Estado</dt>
              <dd>{dept.status}</dd>
            </div>
            <div>
              <dt>Equipo</dt>
              <dd>{dept.employeeAgentIds.length} personas en el Departamento</dd>
            </div>
          </dl>
        </div>
      )}

      <h2 className="customer-zero__section">¿Qué quieres conseguir?</h2>
      <div className="customer-zero__chat-input">
        <input
          type="text"
          value={props.goalInput}
          onChange={(event) => props.onGoalInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onGiveGoal();
          }}
          placeholder="Por ejemplo: Necesito conseguir más clientes."
          disabled={props.workBusy}
        />
        <button
          type="button"
          onClick={props.onGiveGoal}
          disabled={props.workBusy || props.goalInput.trim().length === 0}
        >
          Poner a trabajar
        </button>
      </div>

      {props.work && (
        <div className="customer-zero__review">
          <h2>Plan de Marketing</h2>
          <p className="customer-zero__muted">{props.work.summary}</p>
          <div className="customer-zero__work-items">
            {props.work.items.map((item) => (
              <div key={item.id} className="customer-zero__work-item">
                <div className="customer-zero__work-item-head">
                  <strong>{item.title}</strong>
                  <span
                    className={`customer-zero__badge customer-zero__badge--${item.status ?? "pending"}`}
                  >
                    {statusLabel(item.status)}
                  </span>
                </div>
                <p className="customer-zero__muted">{item.description}</p>
                {(item.status === "pending" || item.status === "running") && (
                  <button
                    type="button"
                    className="customer-zero__submit customer-zero__submit--small"
                    disabled={props.workBusy}
                    onClick={() => props.onExecuteItem(item.id)}
                  >
                    Ejecutar
                  </button>
                )}
                {item.status === "needs_approval" && (
                  <button
                    type="button"
                    className="customer-zero__submit customer-zero__submit--small"
                    disabled={props.workBusy}
                    onClick={() => props.onApproveItem(item.id)}
                  >
                    Aprobar
                  </button>
                )}
                {item.result && (
                  <p className="customer-zero__work-result">{item.result}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="customer-zero__section">Habla con Marketing</h2>
      <div className="customer-zero__chat">
        {props.messages.map((message, index) => (
          <div
            key={index}
            className={
              message.role === "user"
                ? "customer-zero__chat-message customer-zero__chat-message--user"
                : "customer-zero__chat-message"
            }
          >
            <strong>{message.role === "user" ? "Tú" : "Director de Marketing"}</strong>
            <p>{message.content}</p>
          </div>
        ))}
      </div>
      <div className="customer-zero__chat-input">
        <input
          type="text"
          value={props.input}
          onChange={(event) => props.onInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSend();
          }}
          placeholder="Escribe un mensaje…"
          disabled={props.busy}
        />
        <button
          type="button"
          onClick={props.onSend}
          disabled={props.busy || props.input.trim().length === 0}
        >
          Enviar
        </button>
      </div>
    </>
  );
}

function statusLabel(status?: string): string {
  switch (status) {
    case "needs_approval":
      return "Necesita aprobación";
    case "approved":
      return "Aprobado";
    case "completed":
      return "Completado";
    case "running":
      return "Trabajando";
    case "failed":
      return "Falló";
    case "unavailable":
      return "Capacidad no conectada";
    default:
      return "Pendiente";
  }
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { useOrg } from "@/app/org-context";

/**
 * Onboarding (Customer Zero UX v2 flow, consolidated shell).
 *
 * The CEO explains what he wants to achieve; Departify learns, works
 * visibly, asks only what it cannot know, offers the connections it needs
 * inside the conversation, and hands the company over to its Marketing head.
 * When the handover happens, the CEO enters the portal shell — this route
 * never renders the department itself.
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

type Step =
  | { name: "intake" }
  | { name: "researching"; org: string }
  | { name: "conversation"; org: string };

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
  const navigate = useNavigate();
  const { setOrganizationId } = useOrg();
  const [step, setStep] = useState<Step>({ name: "intake" });
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationResponse | null>(null);
  const [handoff, setHandoff] = useState<string>("");
  const [entering, setEntering] = useState(false);

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
        };
        if (cancelled) return;
        if (status.department) {
          // The company already has its department: go straight to the portal.
          setOrganizationId(status.organizationId);
          navigate("/inicio", { replace: true });
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
  }, [navigate, setOrganizationId]);

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
      setOrganizationId(body.organizationId);
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

  /**
   * Handover: the company gets its Marketing department and the CEO enters
   * the portal, where Elvira and her team are already working.
   */
  async function enterCompany(org: string) {
    if (entering) return;
    setEntering(true);
    setError(null);
    try {
      const response = await fetch(`/api/customer-zero/${org}/marketing`, {
        method: "POST",
      });
      if (!response.ok) {
        setError(`Error ${response.status}`);
        setEntering(false);
        return;
      }
      setOrganizationId(org);
      navigate("/inicio");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setEntering(false);
    }
  }

  return (
    <main className="customer-zero" aria-labelledby="customer-zero-title">
      <section className="customer-zero__panel">
        <p className="customer-zero__label">Departify</p>
        <ol className="customer-zero__steps" aria-label="Progreso">
          {(["intake", "researching", "conversation"] as const).map((name, index) => (
            <li
              key={name}
              className={
                name === step.name
                  ? "customer-zero__step customer-zero__step--active"
                  : index < ["intake", "researching", "conversation"].indexOf(step.name)
                    ? "customer-zero__step customer-zero__step--done"
                    : "customer-zero__step"
              }
            />
          ))}
        </ol>
        <h1 id="customer-zero-title">
          {step.name === "intake" && "Cuéntame lo mínimo sobre tu empresa"}
          {step.name === "researching" && "Conociendo tu negocio…"}
          {step.name === "conversation" && "Solo un par de cosas más"}
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
            entering={entering}
            onStartMarketing={() => enterCompany(step.org)}
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
  entering?: boolean;
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
            disabled={props.entering ?? false}
            onClick={props.onStartMarketing}
          >
            {props.entering ? "Entrando…" : "Vamos a trabajar"}
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

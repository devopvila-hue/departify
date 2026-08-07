import { useState, type FormEvent } from "react";

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

export interface MandatoryQuestion {
  category: string;
  question: string;
  type: string;
  options?: string[];
  importance: string;
  priority: number;
}

export interface AnalyzeResponse {
  organizationId: string;
  url: string;
  understood: InterpretedBusiness;
  gaps: unknown[];
  questions: unknown[];
  mandatoryQuestions: MandatoryQuestion[];
  companyDna: Record<string, unknown>;
  gapCount: number;
}

export interface AnswersResponse {
  organizationId: string;
  gaps: unknown[];
  questions: unknown[];
  mandatoryQuestions: MandatoryQuestion[];
  companyDna: Record<string, unknown>;
  gapCount: number;
}

export interface DepartmentSurface {
  id: string;
  name: string;
  description: string;
  directorAgentId: string | null;
  employeeAgentIds: string[];
  status: string;
  connections: {
    kind: string;
    referenceId: string;
    label?: string;
  }[];
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

export interface ChatResponse {
  organizationId: string;
  reply: string;
}

export interface Corrections {
  mission: string;
  market: string;
  positioning: string;
  valueProposition: string;
}

type Step =
  | { name: "url" }
  | { name: "analyzing"; url: string }
  | { name: "review"; analyze: AnalyzeResponse; corrections: Corrections }
  | { name: "questions"; org: string; mandatoryQuestions: MandatoryQuestion[] }
  | { name: "prepare"; org: string; corrected: AnswersResponse }
  | { name: "marketing"; org: string; surface: PrepareMarketingResponse };

export function CustomerZeroRoute() {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState<Step>({ name: "url" });
  const [error, setError] = useState<string | null>(null);
  // Chat state.
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStep({ name: "analyzing", url });

    try {
      const response = await fetch("/api/customer-zero/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json()) as AnalyzeResponse & {
        error?: { code: string; message: string };
      };
      if (!response.ok || body.error) {
        setError(body.error?.message ?? `Error ${response.status}`);
        setStep({ name: "url" });
        return;
      }
      setStep({
        name: "review",
        analyze: body,
        corrections: seedCorrections(body.understood),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStep({ name: "url" });
    }
  }

  async function persistAnswers(
    org: string,
    answers: Readonly<Record<string, string>>,
  ): Promise<AnswersResponse | null> {
    setError(null);
    try {
      const response = await fetch(`/api/customer-zero/${org}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = (await response.json()) as AnswersResponse & {
        error?: string;
      };
      if (!response.ok || body.error) {
        setError(typeof body.error === "string" ? body.error : `Error ${response.status}`);
        return null;
      }
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }

  async function confirmCorrections(
    org: string,
    corrections: Corrections,
  ) {
    // Corrections are persisted into the Company DNA (user_input provenance).
    const result = await persistAnswers(org, {
      mission: corrections.mission,
      market: corrections.market,
      positioning: corrections.positioning,
      value_proposition: corrections.valueProposition,
    });
    if (!result) return;

    // Continue with the mandatory questions that still cannot be inferred.
    if (result.mandatoryQuestions.length > 0) {
      setStep({ name: "questions", org, mandatoryQuestions: result.mandatoryQuestions });
    } else {
      setStep({ name: "prepare", org, corrected: result });
    }
  }

  async function submitAnswers(
    org: string,
    answers: Readonly<Record<string, string>>,
  ) {
    const result = await persistAnswers(org, answers);
    if (!result) return;
    setStep({ name: "prepare", org, corrected: result });
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
      setStep({ name: "marketing", org, surface: body });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      const body = (await response.json()) as ChatResponse & { error?: { message: string } };
      if (!response.ok || body.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${body.error?.message ?? response.status}` },
        ]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: body.reply }]);
      }
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
        <p className="customer-zero__label">Departify · Customer Zero</p>
        <h1 id="customer-zero-title">
          {step.name === "url" && "Empieza con la web de tu empresa"}
          {step.name === "analyzing" && "Conociendo tu negocio…"}
          {step.name === "review" && "Esto es lo que hemos entendido"}
          {step.name === "questions" && "Solo necesitamos algunas cosas que no podemos saber por nuestra cuenta"}
          {step.name === "prepare" && "Confirmando el conocimiento"}
          {step.name === "marketing" && "Departamento de Marketing"}
        </h1>

        {error && (
          <div className="customer-zero__state customer-zero__state--error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {step.name === "url" && (
          <form onSubmit={analyze} className="customer-zero__form">
            <label className="customer-zero__field">
              <span>¿Cuál es la web de tu empresa?</span>
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://empresa.com"
                required
              />
            </label>
            <button type="submit" className="customer-zero__submit" disabled={url.trim().length === 0}>
              Conocer mi negocio
            </button>
          </form>
        )}

        {step.name === "analyzing" && (
          <div className="customer-zero__state" role="status">
            <p>Departify está investigando la empresa real…</p>
            <ul className="customer-zero__stages">
              <li>Revisando la web</li>
              <li>Identificando qué vende</li>
              <li>Entendiendo a quién se dirige</li>
              <li>Analizando cómo se presenta</li>
              <li>Detectando qué necesita confirmación</li>
            </ul>
          </div>
        )}

        {step.name === "review" && (
          <ReviewStep
            analyze={step.analyze}
            initialCorrections={step.corrections}
            onConfirm={(corrections) => confirmCorrections(step.analyze.organizationId, corrections)}
          />
        )}

        {step.name === "questions" && (
          <QuestionsStep
            questions={step.mandatoryQuestions}
            onSubmit={(answers) => submitAnswers(step.org, answers)}
          />
        )}

        {step.name === "prepare" && (
          <PrepareStep corrected={step.corrected} onPrepare={() => prepareMarketing(step.org)} />
        )}

        {step.name === "marketing" && (
          <MarketingStep
            surface={step.surface}
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

function seedCorrections(understood: InterpretedBusiness): Corrections {
  return {
    mission: understood.mission ?? "",
    market: understood.market ?? "",
    positioning: understood.positioning ?? "",
    valueProposition: understood.valueProposition ?? "",
  };
}

function ReviewStep(props: {
  analyze: AnalyzeResponse;
  initialCorrections: Corrections;
  onConfirm: (corrections: Corrections) => void;
}) {
  const [corrections, setCorrections] = useState(props.initialCorrections);
  const [busy, setBusy] = useState(false);

  function set(key: keyof Corrections, value: string) {
    setCorrections((prev) => ({ ...prev, [key]: value }));
  }

  const understood = props.analyze.understood;

  return (
    <>
      <p className="customer-zero__intro">
        Esto es lo que Departify ha descubierto de{" "}
        <strong>{props.analyze.url}</strong>. Revísalo y corrige lo que sea
        necesario.
      </p>

      <div className="customer-zero__review">
        <h2>Lo que hemos entendido</h2>
        <dl>
          {understood.companyName && <div><dt>Empresa</dt><dd>{understood.companyName}</dd></div>}
          {understood.activity && <div><dt>Actividad</dt><dd>{understood.activity}</dd></div>}
          {understood.products && understood.products.length > 0 && (
            <div><dt>Productos</dt><dd>{understood.products.join(", ")}</dd></div>
          )}
          {understood.targetAudience && understood.targetAudience.length > 0 && (
            <div><dt>A quién se dirige</dt><dd>{understood.targetAudience.join(", ")}</dd></div>
          )}
          {understood.tone && understood.tone.length > 0 && (
            <div><dt>Tono</dt><dd>{understood.tone.join(", ")}</dd></div>
          )}
          {understood.locations && understood.locations.length > 0 && (
            <div><dt>Ubicaciones</dt><dd>{understood.locations.join(", ")}</dd></div>
          )}
        </dl>
      </div>

      <h2 className="customer-zero__section">Corrige o completa</h2>
      <div className="customer-zero__form">
        <CorrectionField
          label="Misión"
          value={corrections.mission}
          onChange={(value) => set("mission", value)}
        />
        <CorrectionField
          label="Mercado / industria"
          value={corrections.market}
          onChange={(value) => set("market", value)}
        />
        <CorrectionField
          label="Posicionamiento"
          value={corrections.positioning}
          onChange={(value) => set("positioning", value)}
        />
        <CorrectionField
          label="Propuesta de valor"
          value={corrections.valueProposition}
          onChange={(value) => set("valueProposition", value)}
        />
      </div>

      <div className="customer-zero__review">
        <h2>Información que falta</h2>
        <p className="customer-zero__muted">
          {props.analyze.gapCount} puntos necesitan confirmación. Marketing te
          hará solo las preguntas imprescindibles.
        </p>
      </div>

      <button
        type="button"
        className="customer-zero__submit"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          props.onConfirm(corrections);
        }}
      >
        {busy ? "Confirmando…" : "Confirmar y continuar"}
      </button>
    </>
  );
}

function CorrectionField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="customer-zero__field">
      <span>{props.label}</span>
      <input
        type="text"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function QuestionsStep(props: {
  questions: MandatoryQuestion[];
  onSubmit: (answers: Readonly<Record<string, string>>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function setAnswer(category: string, value: string) {
    setAnswers((prev) => ({ ...prev, [category]: value }));
  }

  return (
    <>
      <p className="customer-zero__intro">
        Ya hemos analizado tu empresa. Solo necesitamos algunas cosas que no
        podemos saber por nuestra cuenta.
      </p>

      {props.questions.length === 0 ? (
        <div className="customer-zero__review">
          <h2>Sin preguntas pendientes</h2>
          <p className="customer-zero__muted">
            Hemos podido deducir lo necesario. Puedes continuar.
          </p>
        </div>
      ) : (
        <div className="customer-zero__form">
          {props.questions.map((question) => (
            <label key={question.category} className="customer-zero__field">
              <span>{question.question}</span>
              {question.options && question.options.length > 0 ? (
                <select
                  value={answers[question.category] ?? ""}
                  onChange={(event) => setAnswer(question.category, event.target.value)}
                >
                  <option value="">Selecciona…</option>
                  {question.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={answers[question.category] ?? ""}
                  onChange={(event) => setAnswer(question.category, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      )}

      <button
        type="button"
        className="customer-zero__submit"
        disabled={busy || props.questions.length === 0}
        onClick={() => {
          setBusy(true);
          props.onSubmit(answers);
        }}
      >
        {busy ? "Guardando…" : "Continuar"}
      </button>
    </>
  );
}

function PrepareStep(props: {
  corrected: AnswersResponse;
  onPrepare: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="customer-zero__intro">
        Gracias. El conocimiento de la empresa está listo. Ahora preparamos el
        Departamento de Marketing para que empiece a trabajar.
      </p>
      <div className="customer-zero__review">
        <h2>Conocimiento confirmado</h2>
        <p className="customer-zero__muted">
          {props.corrected.gapCount} puntos pendientes de confirmar con preguntas
          imprescindibles.
        </p>
      </div>
      <button
        type="button"
        className="customer-zero__submit"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          props.onPrepare();
        }}
      >
        {busy ? "Preparando Marketing…" : "Poner Marketing a trabajar"}
      </button>
    </>
  );
}

function MarketingStep(props: {
  surface: PrepareMarketingResponse;
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
          "Marketing ya conoce tu negocio. Entra y habla con el Director."
        )}
      </p>

      {dept && (
        <div className="customer-zero__review">
          <h2>{dept.name}</h2>
          <dl>
            <div><dt>Estado</dt><dd>{dept.status}</dd></div>
            {dept.directorAgentId && <div><dt>Director</dt><dd>{dept.directorAgentId}</dd></div>}
            <div>
              <dt>Equipo</dt>
              <dd>{dept.employeeAgentIds.length} personas en el Departamento</dd>
            </div>
            {dept.connections.length > 0 && (
              <div>
                <dt>Conectado a</dt>
                <dd>
                  {dept.connections
                    .map((c) => c.label ?? c.referenceId)
                    .filter(Boolean)
                    .join(", ") || "—"}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {props.surface.firstResult && (
        <div className="customer-zero__review">
          <h2>Primer resultado</h2>
          <p className="customer-zero__muted">
            El Departamento ya ha producido su primer análisis del negocio.
          </p>
        </div>
      )}

      <h2 className="customer-zero__section">Habla con Marketing</h2>
      <div className="customer-zero__chat">
        {props.messages.length === 0 && (
          <p className="customer-zero__muted">
            Pregunta al Director de Marketing, por ejemplo: «Basándote en lo que
            acabas de aprender de mi negocio, ¿cuáles serían las tres primeras
            prioridades de Marketing y por qué?»
          </p>
        )}
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

import { useState, type FormEvent } from "react";

export interface CustomerZeroMarketingInput {
  readonly companyName: string;
  readonly rawData: Readonly<Record<string, unknown>>;
}

export interface CustomerZeroMarketingResult {
  readonly status: "completed" | "failed";
  readonly organizationId: string;
  readonly companyName: string;
  readonly department: "Marketing";
  readonly firstResult: {
    readonly confidence: string;
    readonly gapCount: number;
    readonly criticalGapCount: number;
    readonly blockingGapCount: number;
    readonly questionCount: number;
  } | null;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  readonly runId: string;
}

const CUSTOMER_ZERO_ENDPOINT = "/api/customer-zero/marketing";

export function CustomerZeroRoute() {
  const [companyName, setCompanyName] = useState("MOON Shared Living");
  const [companyInfo, setCompanyInfo] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<CustomerZeroMarketingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function putMarketingToWork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("working");
    setResult(null);
    setError(null);

    try {
      const rawData = buildRawData(companyInfo);
      const response = await fetch(CUSTOMER_ZERO_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName,
          rawData,
        } satisfies CustomerZeroMarketingInput),
      });

      if (!response.ok) {
        setError(`El servidor respondió con error ${response.status}.`);
        setStatus("error");
        return;
      }

      const payload = (await response.json()) as CustomerZeroMarketingResult;
      setResult(payload);
      setStatus(payload.status === "completed" ? "done" : "error");
      if (payload.status !== "completed") {
        setError(
          payload.errors.map((e) => e.message).join(" · ") ||
            "El trabajo no pudo completarse.",
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("error");
    }
  }

  return (
    <main className="customer-zero" aria-labelledby="customer-zero-title">
      <section className="customer-zero__panel">
        <p className="customer-zero__label">Departify · Customer Zero</p>
        <h1 id="customer-zero-title">Poner el Departamento de Marketing a trabajar</h1>
        <p className="customer-zero__intro">
          Cuéntanos tu empresa. Marketing la conocerá, la analizará y producirá
          su primer resultado.
        </p>

        <form onSubmit={putMarketingToWork} className="customer-zero__form">
          <label className="customer-zero__field">
            <span>Empresa</span>
            <input
              type="text"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              required
              disabled={status === "working"}
            />
          </label>

          <label className="customer-zero__field">
            <span>Información de tu empresa</span>
            <textarea
              value={companyInfo}
              onChange={(event) => setCompanyInfo(event.target.value)}
              rows={6}
              placeholder="Por ejemplo: misión, qué productos o servicios vendes, tu mercado, a quién te diriges, qué te hace diferente…"
              disabled={status === "working"}
            />
          </label>

          <p className="customer-zero__department">
            Departamento: <strong>Marketing</strong>
          </p>

          <button
            type="submit"
            className="customer-zero__submit"
            disabled={status === "working" || companyName.trim().length === 0}
          >
            {status === "working" ? "Marketing está trabajando…" : "Poner Marketing a trabajar"}
          </button>
        </form>

        {status === "working" && (
          <div className="customer-zero__state" role="status">
            <p>El Departamento de Marketing está trabajando para {companyName}…</p>
            <p className="customer-zero__state-hint">
              Conociendo la empresa · Analizando · Planificando · Primer trabajo
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="customer-zero__state customer-zero__state--error" role="alert">
            <p>No se pudo completar el trabajo.</p>
            {error ? <p className="customer-zero__error">{error}</p> : null}
          </div>
        )}

        {status === "done" && result?.firstResult && (
          <div className="customer-zero__result" role="region" aria-label="Primer resultado">
            <h2>Primer resultado de Marketing</h2>
            <dl className="customer-zero__metrics">
              <div>
                <dt>Confianza en el conocimiento</dt>
                <dd>{result.firstResult.confidence}</dd>
              </div>
              <div>
                <dt>Información pendiente de la empresa</dt>
                <dd>{result.firstResult.gapCount}</dd>
              </div>
              <div>
                <dt>Puntos críticos pendientes</dt>
                <dd>{result.firstResult.criticalGapCount}</dd>
              </div>
              <div>
                <dt>Bloqueos para actuar</dt>
                <dd>{result.firstResult.blockingGapCount}</dd>
              </div>
              <div>
                <dt>Preguntas que Marketing te hará</dt>
                <dd>{result.firstResult.questionCount}</dd>
              </div>
            </dl>
            <p className="customer-zero__run">
              Marketing ya conoce {result.companyName} y ha producido su primer
              resultado. Aún necesita que respondas a sus preguntas para
              completar su conocimiento.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

/**
 * Maps the CEO's free-form company information into the `rawData` shape the
 * Business Discovery pipeline understands (Sprint 55). Kept deliberately
 * simple: a best-effort interpretation of a plain-text description.
 */
function buildRawData(companyInfo: string): Readonly<Record<string, unknown>> {
  const trimmed = companyInfo.trim();
  if (trimmed.length === 0) {
    return {};
  }

  const rawData: Record<string, unknown> = {};

  const firstLine = trimmed.split("\n")[0]?.trim();
  if (firstLine) {
    rawData.mission = {
      statement: firstLine,
      confidence: verifiedConfidence(),
    };
  }

  return rawData;
}

function verifiedConfidence(): {
  readonly level: "verified";
  readonly source: "user_input";
  readonly lastVerified: string;
} {
  return {
    level: "verified",
    source: "user_input",
    lastVerified: new Date().toISOString(),
  };
}

import { useEffect, useState } from "react";

import { api, type CompanyStatus, type UnderstandingView } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Card, EmptyState } from "@/components/primitives";

/**
 * Empresa — what Departify knows about your company.
 *
 * The CEO can check (and later correct) the understanding his team works
 * with. No schema, no confidence scores, no provenance internals.
 */
export function CompanyRoute() {
  const { organizationId } = useOrg();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [understanding, setUnderstanding] = useState<UnderstandingView | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    void Promise.all([api.status(organizationId), api.understanding(organizationId)]).then(
      ([statusData, understandingData]) => {
        if (statusData) setStatus(statusData);
        if (understandingData) setUnderstanding(understandingData);
      },
    );
  }, [organizationId]);

  const onboarding = status?.onboarding;
  const transcript = status?.discoveryTranscript ?? [];
  const known = understanding;
  const sourceLabel = (field: string): string => {
    const source = known?.provenance?.[field];
    return source === "ceo" ? "Confirmado" : source ? "Aprendido" : "";
  };
  const gapLabel = (gap: string): string => ({
    company_name: "nombre de la empresa",
    what_the_company_does: "qué hace la empresa",
    objective: "objetivo",
    geography: "dónde opera",
  })[gap] ?? gap;

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Empresa</p>
        <h1>{known?.companyName ?? status?.companyName ?? "Tu empresa"}</h1>
        {(known?.objective ?? onboarding?.goal) && (
          <p className="dfy-hero__goal">
            Objetivo: <strong>{known?.objective ?? onboarding?.goal}</strong>
          </p>
        )}
      </section>

      <Card title="Lo básico">
        <dl className="dfy-facts">
          {status?.url && (
            <div>
              <dt>Web</dt>
              <dd>{status.url}</dd>
            </div>
          )}
          {(known?.description ?? onboarding?.description) && (
            <div>
              <dt>Qué estáis creando</dt>
              <dd>{known?.description ?? onboarding?.description}</dd>
            </div>
          )}
          {(known?.geography ?? onboarding?.country) && (
            <div>
              <dt>País principal</dt>
              <dd>{known?.geography ?? onboarding?.country}</dd>
            </div>
          )}
          {onboarding?.companySize && (
            <div>
              <dt>Tamaño</dt>
              <dd>{onboarding.companySize}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title="Lo que Departify sabe">
        {!known ? (
          <EmptyState
            title="Todavía no hay una síntesis disponible"
            description="La información aparecerá cuando termine la investigación de tu empresa."
          />
        ) : (
          <>
            <p className="dfy-muted dfy-muted--small">
              {known.confirmed
                ? "Información confirmada por ti."
                : "Información aprendida; todavía puedes corregirla durante la revisión."}
            </p>
            {known.products.length > 0 && (
              <div className="dfy-facts">
                <div><dt>Productos o servicios {sourceLabel("products") && <small>· {sourceLabel("products")}</small>}</dt><dd>{known.products.join(", ")}</dd></div>
              </div>
            )}
            {known.customers.length > 0 && (
              <div className="dfy-facts">
                <div><dt>Clientes {sourceLabel("customers") && <small>· {sourceLabel("customers")}</small>}</dt><dd>{known.customers.join(", ")}</dd></div>
              </div>
            )}
            {known.positioning && (
              <div className="dfy-facts"><div><dt>Posicionamiento {sourceLabel("positioning") && <small>· {sourceLabel("positioning")}</small>}</dt><dd>{known.positioning}</dd></div></div>
            )}
            {known.businessModel && (
              <div className="dfy-facts"><div><dt>Modelo de negocio {sourceLabel("businessModel") && <small>· {sourceLabel("businessModel")}</small>}</dt><dd>{known.businessModel}</dd></div></div>
            )}
            {known.declaredTools.length > 0 && (
              <div className="dfy-facts">
                <div><dt>Herramientas que has mencionado</dt><dd>{known.declaredTools.join(", ")}</dd></div>
              </div>
            )}
            {known.missing.length > 0 && (
              <p className="dfy-note">
                Falta completar: {known.missing.map(gapLabel).join(", ")}.
              </p>
            )}
            {known.uncertainties.length > 0 && (
              <p className="dfy-muted dfy-muted--small">
                Aspectos por confirmar: {known.uncertainties.join("; ")}
              </p>
            )}
          </>
        )}
      </Card>

      <Card title="Lo que nos has contado">
        {transcript.length === 0 ? (
          <EmptyState
            title="Nada más por ahora"
            description="Tu equipo irá aprendiendo de tu empresa mientras trabaja."
          />
        ) : (
          <ul className="dfy-list">
            {transcript.map((turn) => (
              <li key={turn.questionId}>
                <strong>{turn.question}</strong>
                <p className="dfy-muted">{turn.answer}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

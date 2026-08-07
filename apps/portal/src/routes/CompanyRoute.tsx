import { useEffect, useState } from "react";

import { api, type CompanyStatus } from "@/app/api";
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

  useEffect(() => {
    if (!organizationId) return;
    void api.status(organizationId).then((data) => {
      if (data) setStatus(data);
    });
  }, [organizationId]);

  const onboarding = status?.onboarding;
  const transcript = status?.discoveryTranscript ?? [];

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Empresa</p>
        <h1>{status?.companyName ?? "Tu empresa"}</h1>
        {onboarding?.goal && (
          <p className="dfy-hero__goal">
            Objetivo: <strong>{onboarding.goal}</strong>
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
          {onboarding?.description && (
            <div>
              <dt>Qué estáis creando</dt>
              <dd>{onboarding.description}</dd>
            </div>
          )}
          {onboarding?.country && (
            <div>
              <dt>País principal</dt>
              <dd>{onboarding.country}</dd>
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

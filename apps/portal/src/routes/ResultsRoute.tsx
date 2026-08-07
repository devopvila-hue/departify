import { useEffect, useState } from "react";

import { api, type CeoOverview } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Card, EmptyState, HeadBadge } from "@/components/primitives";
import { readable } from "@/app/readable";

/** Resultados — what your company has achieved, not what the system ran. */
export function ResultsRoute() {
  const { organizationId } = useOrg();
  const [overview, setOverview] = useState<CeoOverview | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    void api.overview(organizationId).then((data) => {
      if (data) setOverview(data);
    });
  }, [organizationId]);

  const results = overview?.results ?? [];

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Resultados</p>
        <h1>Lo que ha conseguido tu empresa</h1>
        {overview?.goal && (
          <p className="dfy-hero__goal">
            Para: <strong>{overview.goal}</strong>
          </p>
        )}
      </section>

      {results.length === 0 ? (
        <Card>
          <EmptyState
            title="Todavía no hay entregables"
            description="En cuanto Marketing termine un trabajo, su resultado aparecerá aquí listo para usar."
          />
        </Card>
      ) : (
        <div className="dfy-grid dfy-grid--single">
          {results.map((result) => (
            <Card key={result.id} title={result.title}>
              <HeadBadge head={result.head} compact />
              <p className="dfy-result">{readable(result.summary)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

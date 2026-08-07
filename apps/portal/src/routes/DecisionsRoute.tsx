import { useCallback, useEffect, useState } from "react";

import { api, type CeoOverview } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Card, EmptyState, HeadBadge } from "@/components/primitives";

/**
 * Decisiones — the CEO's decision inbox.
 *
 * A department head proposes something in business language; the CEO
 * approves or asks for changes. No tool executions, no permission ids.
 */
export function DecisionsRoute() {
  const { organizationId } = useOrg();
  const [overview, setOverview] = useState<CeoOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.overview(organizationId);
    if (data) setOverview(data);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(id: string) {
    if (!organizationId) return;
    setBusy(id);
    await api.itemAction(organizationId, id, "approve");
    setBusy(null);
    await load();
  }

  const decisions = overview?.decisions ?? [];

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Decisiones</p>
        <h1>Lo que necesita tu criterio</h1>
        <p className="dfy-hero__lead">
          Tus jefes de departamento trabajan solos hasta aquí. Estas son las
          decisiones que te corresponden.
        </p>
      </section>

      {decisions.length === 0 ? (
        <Card>
          <EmptyState
            title="No hay decisiones pendientes"
            description="Cuando alguien de tu equipo necesite tu aprobación, lo verás aquí."
          />
        </Card>
      ) : (
        <div className="dfy-grid dfy-grid--single">
          {decisions.map((decision) => (
            <Card key={decision.id}>
              <HeadBadge head={decision.head} />
              <p className="dfy-decision__proposal">{decision.proposal}</p>
              {open === decision.id && (
                <p className="dfy-muted">{decision.detail}</p>
              )}
              {decision.note && <p className="dfy-note">{decision.note}</p>}
              <div className="dfy-actions">
                <button
                  type="button"
                  className="dfy-button dfy-button--ghost"
                  onClick={() =>
                    setOpen((prev) => (prev === decision.id ? null : decision.id))
                  }
                >
                  {open === decision.id ? "Ocultar propuesta" : "Ver propuesta"}
                </button>
                {decision.status === "pending" && (
                  <button
                    type="button"
                    className="dfy-button"
                    disabled={busy === decision.id}
                    onClick={() => void approve(decision.id)}
                  >
                    {busy === decision.id ? "Aprobando…" : "Aprobar"}
                  </button>
                )}
                {decision.status === "resolved" && (
                  <span className="dfy-muted dfy-muted--small">
                    Ya lo has decidido.
                  </span>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

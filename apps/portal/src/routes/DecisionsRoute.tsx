import { useCallback, useEffect, useState } from "react";

import { api, type CeoOverview } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState, HeadBadge } from "@/components/primitives";

/**
 * Aprobaciones — the CEO's decision inbox (Sprint ENGINE 04).
 *
 * A department head proposes something in business language; the CEO approves
 * or rejects. Includes both the legacy Customer Zero decisions and the
 * ENGINE 03 MarketingService approvals. No tool executions, no technical ids.
 */

interface MarketingApprovalView {
  id: string;
  from: string;
  title: string;
  detail: string;
  cost?: string;
  status: string;
  createdAt: string;
}

export function DecisionsRoute() {
  const { organizationId } = useOrg();
  const [overview, setOverview] = useState<CeoOverview | null>(null);
  const [marketingApprovals, setMarketingApprovals] = useState<MarketingApprovalView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [overviewData, approvalsData] = await Promise.all([
      api.overview(organizationId),
      api.marketingApprovals(organizationId),
    ]);
    if (overviewData) setOverview(overviewData);
    if (approvalsData) setMarketingApprovals(approvalsData.approvals ?? []);
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

  async function decideMarketing(id: string, action: "approve" | "reject") {
    if (!organizationId) return;
    setBusy(id);
    await api.decideMarketingApproval(organizationId, id, action);
    setBusy(null);
    await load();
  }

  const decisions = overview?.decisions ?? [];
  const pending = marketingApprovals.filter((a) => a.status === "pending");
  const hasAny = decisions.length > 0 || pending.length > 0;

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Aprobaciones</p>
        <h1>Lo que necesita tu criterio</h1>
        <p className="dfy-hero__lead">
          Tus jefes de departamento trabajan solos hasta aquí. Estas son las
          decisiones que te corresponden.
        </p>
      </section>

      {!hasAny ? (
        <Card>
          <EmptyState
            title="No hay aprobaciones pendientes"
            description="Cuando alguien de tu equipo necesite tu decisión, lo verás aquí."
          />
        </Card>
      ) : (
        <div className="dfy-grid dfy-grid--single">
          {pending.map((approval) => (
            <Card key={approval.id}>
              <div className="dfy-approval__title">
                <strong>{approval.title}</strong>
                {approval.cost && <Badge tone="warning">{approval.cost}</Badge>}
              </div>
              <p className="dfy-muted dfy-muted--small">
                {approval.from} · Marketing
              </p>
              {open === approval.id && (
                <p className="dfy-muted">{approval.detail}</p>
              )}
              <div className="dfy-actions">
                <button
                  type="button"
                  className="dfy-button dfy-button--ghost"
                  onClick={() =>
                    setOpen((prev) => (prev === approval.id ? null : approval.id))
                  }
                >
                  {open === approval.id ? "Ocultar propuesta" : "Ver propuesta"}
                </button>
                <button
                  type="button"
                  className="dfy-button"
                  disabled={busy === approval.id}
                  onClick={() => void decideMarketing(approval.id, "approve")}
                >
                  {busy === approval.id ? "Decidiendo…" : "Aprobar"}
                </button>
                <button
                  type="button"
                  className="dfy-button dfy-button--ghost"
                  disabled={busy === approval.id}
                  onClick={() => void decideMarketing(approval.id, "reject")}
                >
                  Rechazar
                </button>
              </div>
            </Card>
          ))}

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

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  api,
  type CompanyStatus,
  type HeadIdentity,
  type MarketingWorkState,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState, HeadBadge } from "@/components/primitives";
import { readable } from "@/app/readable";

/**
 * Marketing — workspace (Sprint 58).
 *
 * The Marketing chat is no longer a primary surface here. The CEO talks to
 * DEPARTIFY in the Command Center (Home). This workspace shows what is
 * happening: the responsible head, the current objective, the team working,
 * the work in progress, results, and tools relevant to Marketing.
 *
 * Each work item exposes a "Preguntar sobre esto" action that opens the
 * Command Center with a contextual message. The CEO never has to manage
 * the team directly.
 */
export function MarketingRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [head, setHead] = useState<HeadIdentity | null>(null);
  const [work, setWork] = useState<MarketingWorkState | null>(null);
  const [itemBusy, setItemBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [statusData, handoff] = await Promise.all([
      api.status(organizationId),
      api.handoff(organizationId),
    ]);
    if (statusData) {
      setStatus(statusData);
      setWork(statusData.marketingWork ?? null);
    }
    if (handoff) setHead(handoff.head);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runItem(itemId: string, action: "execute" | "approve") {
    if (!organizationId) return;
    setItemBusy(itemId);
    setError(null);
    const result = await api.itemAction(organizationId, itemId, action);
    setItemBusy(null);
    if (!result || result.error) {
      setError(
        "Marketing no ha podido terminar esto ahora mismo. Inténtalo de nuevo.",
      );
      return;
    }
    setWork((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((item) =>
              item.id === itemId
                ? { ...item, status: result.status, result: result.result }
                : item,
            ),
          }
        : prev,
    );
  }

  function askAbout(itemId: string, title: string) {
    const focus = encodeURIComponent(
      `¿Cómo va "${title}"? (ref ${itemId})`,
    );
    navigate(`/?focus=${focus}`);
  }

  const connected = (status?.connections ?? []).filter(
    (connection) => connection.status === "connected",
  );

  const team = status?.marketingWork?.items ? null : null;

  return (
    <div className="dfy-page">
      <section className="dfy-hero dfy-hero--department">
        <p className="dfy-eyebrow">Departamento</p>
        <h1>Marketing</h1>
        {head && <HeadBadge head={head} />}
        {work?.goal && (
          <p className="dfy-hero__goal">
            Objetivo: <strong>{work.goal}</strong>
          </p>
        )}
        <p className="dfy-hero__note">
          ¿Quieres comentar algo con el equipo? Háblalo en el{" "}
          <button
            type="button"
            className="dfy-button dfy-button--ghost"
            onClick={() => navigate("/")}
          >
            Command Center
          </button>
          .
        </p>
      </section>

      {error && (
        <p className="dfy-alert" role="alert">
          {error}
        </p>
      )}

      <Card title="Trabajo en curso">
        {!work || work.items.length === 0 ? (
          <EmptyState
            title="Marketing todavía no tiene trabajo"
            description="Dile en el Command Center qué quieres conseguir y Elvira preparará el plan. La conversación queda registrada."
          />
        ) : (
          <>
            <p className="dfy-muted">{work.summary}</p>
            <ul className="dfy-work">
              {work.items.map((item) => (
                <li key={item.id} className="dfy-work__item">
                  <div className="dfy-work__head">
                    <strong>{item.title}</strong>
                    <Badge tone={statusTone(item.status)}>
                      {statusLabel(item.status)}
                    </Badge>
                  </div>
                  <p className="dfy-muted">{item.description}</p>
                  {(item.status === "pending" || item.status === "running") && (
                    <button
                      type="button"
                      className="dfy-button dfy-button--small"
                      disabled={itemBusy === item.id}
                      onClick={() => void runItem(item.id, "execute")}
                    >
                      {itemBusy === item.id ? "Trabajando…" : "Que lo hagan"}
                    </button>
                  )}
                  {item.status === "needs_approval" && (
                    <button
                      type="button"
                      className="dfy-button dfy-button--small"
                      disabled={itemBusy === item.id}
                      onClick={() => void runItem(item.id, "approve")}
                    >
                      Aprobar
                    </button>
                  )}
                  <button
                    type="button"
                    className="dfy-button dfy-button--ghost dfy-button--small"
                    onClick={() => askAbout(item.id, item.title)}
                  >
                    Preguntar sobre esto
                  </button>
                  {item.result && (
                    <p className="dfy-result">{readable(item.result)}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Herramientas del departamento">
        {(status?.connections?.length ?? 0) === 0 ? (
          <EmptyState
            title="Sin herramientas"
            description="Marketing trabajará igualmente, pero con una herramienta conectada podrá hacer más."
          />
        ) : (
          <ul className="dfy-list dfy-list--inline">
            {status?.connections?.map((connection) => (
              <li key={connection.toolId}>
                <strong>{connection.label}</strong>
                <Badge tone={connection.status === "connected" ? "success" : "neutral"}>
                  {connection.status === "connected" ? "Conectado" : "Sin conectar"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {connected.length === 0 && (
          <p className="dfy-muted dfy-muted--small">
            Sin conexiones activas, Marketing no puede enviar ni publicar nada
            por su cuenta. Te lo dirá siempre con honestidad.
          </p>
        )}
      </Card>

      <Card title="Tu rol aquí">
        <p className="dfy-muted">
          Este workspace es información: lo que hace Elvira, su equipo, en qué
          punto está cada cosa y qué herramientas tiene. La conversación con
          la empresa ocurre en el Command Center.
        </p>
        {team && (
          <p className="dfy-muted">
            Equipo trabajando actualmente: {team}.
          </p>
        )}
      </Card>
    </div>
  );
}

function statusLabel(status?: string): string {
  switch (status) {
    case "needs_approval":
      return "Necesita tu aprobación";
    case "approved":
      return "Aprobado";
    case "completed":
      return "Terminado";
    case "running":
      return "En marcha";
    case "failed":
      return "No ha salido";
    case "unavailable":
      return "Falta conectar una herramienta";
    default:
      return "Preparado";
  }
}

function statusTone(
  status?: string,
): "neutral" | "accent" | "warning" | "danger" | "success" {
  switch (status) {
    case "completed":
      return "success";
    case "needs_approval":
      return "warning";
    case "failed":
      return "danger";
    case "unavailable":
      return "warning";
    default:
      return "neutral";
  }
}

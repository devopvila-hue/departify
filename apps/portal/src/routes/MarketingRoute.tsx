import { useCallback, useEffect, useState } from "react";

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
 * Marketing — the reference department surface.
 *
 * Shows who runs it, what its goal is, what it is doing, what is finished,
 * what is blocked, what needs approval and which tools it has. Talking to
 * Elvira must feel like talking to the person who already knows the company,
 * not like a generic chatbot.
 */
export function MarketingRoute() {
  const { organizationId } = useOrg();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [head, setHead] = useState<HeadIdentity | null>(null);
  const [work, setWork] = useState<MarketingWorkState | null>(null);
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
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
      setMessages(statusData.conversation ?? []);
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

  async function send() {
    const content = input.trim();
    if (!organizationId || !content || busy) return;
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content }]);
    setInput("");
    const result = await api.message(organizationId, content);
    setBusy(false);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content:
          result?.reply ??
          "Ahora mismo no he podido responderte. Prueba otra vez en un momento.",
      },
    ]);
  }

  const connected = (status?.connections ?? []).filter(
    (connection) => connection.status === "connected",
  );

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
            description="Dile en Inicio qué quieres conseguir y Elvira preparará el plan."
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

      <Card title={head ? `Habla con ${head.name}` : "Habla con Marketing"}>
        <div className="dfy-chat">
          {messages.length === 0 && (
            <p className="dfy-muted">
              Pregúntale lo que quieras: ya conoce tu empresa, tu objetivo y lo
              que habéis hablado.
            </p>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`dfy-bubble${message.role === "user" ? " dfy-bubble--user" : ""}`}
            >
              <span className="dfy-bubble__who">
                {message.role === "user" ? "Tú" : (head?.name ?? "Marketing")}
              </span>
              <p>{message.content}</p>
            </div>
          ))}
        </div>
        <div className="dfy-composer">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void send();
            }}
            placeholder="Escribe un mensaje…"
            aria-label="Mensaje para Marketing"
            disabled={busy}
          />
          <button
            type="button"
            className="dfy-button"
            onClick={() => void send()}
            disabled={busy || input.trim().length === 0}
          >
            Enviar
          </button>
        </div>
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

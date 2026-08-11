import { useCallback, useEffect, useState } from "react";

import { api, type InboxItemView, type InboxCategory } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Card, EmptyState, Badge } from "@/components/primitives";
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html";

/**
 * Inbox — Customer Zero 03.
 *
 * Unified business intake surface. The inbox imports normalized messages
 * from every connected email provider through /api/customer-zero/:org/inbox/sync. Other
 * channels (lead, campaign_response, form, support) share the
 * same shape and will populate this view when their adapters are
 * wired.
 *
 * The route intentionally avoids a custom layout — it reuses the
 * existing Card / Badge primitives.
 */

const CATEGORIES: readonly { id: InboxCategory | "all"; label: string }[] = [
  { id: "all", label: "Todo" },
  { id: "lead", label: "Leads" },
  { id: "campaign_response", label: "Campañas" },
  { id: "support", label: "Soporte" },
  { id: "customer_question", label: "Consultas" },
  { id: "administrative", label: "Administrativo" },
];

export function InboxRoute() {
  const { organizationId } = useOrg();
  const [items, setItems] = useState<InboxItemView[]>([]);
  const [category, setCategory] = useState<InboxCategory | "all">("all");
  const [syncing, setSyncing] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<InboxItemView | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.inbox(organizationId);
    if (data) setItems(data.items ?? []);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    if (!organizationId || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await api.inboxSync(organizationId);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No hemos podido sincronizar el inbox.");
    } finally {
      setSyncing(false);
    }
  }

  async function toWork(item: InboxItemView) {
    if (!organizationId || workingId) return;
    setWorkingId(item.id);
    setError(null);
    try {
      await api.inboxToWork(organizationId, item.id);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No hemos podido crear la tarea.");
    } finally {
      setWorkingId(null);
    }
  }

  async function openItem(item: InboxItemView) {
    if (!organizationId || openingId) return;
    setOpeningId(item.id);
    setError(null);
    try {
      const result = await api.inboxItem(organizationId, item.id);
      if (result?.item) setSelected(result.item);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No hemos podido abrir el correo.");
    } finally {
      setOpeningId(null);
    }
  }

  const filtered = items.filter(
    (item) => category === "all" || item.category === category,
  );

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Inbox</p>
        <h1>Lo que ha llegado a tu empresa</h1>
        <p className="dfy-hero__lead">
          Correo, leads, respuestas de campaña y soporte, normalizados. Departify
          clasifica y asigna cada elemento al departamento correcto.
        </p>
        <div className="dfy-inbox-actions">
          <button
            type="button"
            className="dfy-button"
            disabled={syncing}
            onClick={() => void sync()}
          >
            {syncing ? "Sincronizando…" : "Sincronizar correo"}
          </button>
        </div>
      </section>

      <nav className="dfy-inbox-filters" aria-label="Categorías">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`dfy-inbox-filter${c.id === category ? " dfy-inbox-filter--active" : ""}`}
            onClick={() => setCategory(c.id)}
          >
            {c.label}
          </button>
        ))}
      </nav>

      {error && (
        <p className="dfy-alert" role="alert">
          {error}
        </p>
      )}

      {selected && (
        <Card className="dfy-inbox-detail">
          <div className="dfy-inbox-detail__actions">
            <button type="button" className="dfy-button dfy-button--small" onClick={() => setSelected(null)}>
              Volver al inbox
            </button>
          </div>
          <p className="dfy-muted dfy-muted--small">
            {selected.source === "hostinger" ? "Correo empresarial" : selected.source}
            {selected.mailbox ? ` · ${selected.mailbox}` : ""}
            {selected.folder ? ` · ${selected.folder}` : ""}
          </p>
          <h2>{selected.subject || "(Sin asunto)"}</h2>
          <p className="dfy-muted dfy-muted--small">
            De: {selected.sender?.displayName ?? selected.senderName ?? selected.senderEmail}
            {selected.sender?.email || selected.senderEmail ? ` <${selected.sender?.email ?? selected.senderEmail}>` : ""}
          </p>
          <p className="dfy-muted dfy-muted--small">
            Para: {(selected.recipients ?? []).map((recipient) => recipient.email).join(", ") || "—"}
            {selected.cc?.length ? ` · CC: ${selected.cc.map((recipient) => recipient.email).join(", ")}` : ""}
            {` · ${new Date(selected.receivedAt).toLocaleString("es-ES")}`}
          </p>
          {selected.plainText ? (
            <div className="dfy-inbox-detail__body">{selected.plainText}</div>
          ) : selected.htmlBody ? (
            <div
              className="dfy-inbox-detail__body dfy-inbox-detail__body--html"
              dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(selected.htmlBody) }}
            />
          ) : (
            <p className="dfy-muted">Este correo no incluye contenido legible.</p>
          )}
          {!!selected.attachments?.length && (
            <div className="dfy-inbox-detail__attachments">
              <strong>Adjuntos</strong>
              <ul>
                {selected.attachments.map((attachment, index) => (
                  <li key={`${attachment.filename ?? "adjunto"}-${index}`}>
                    {attachment.filename ?? "Adjunto"}{attachment.mimeType ? ` · ${attachment.mimeType}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {!selected && filtered.length === 0 ? (
        <Card>
          <EmptyState
            title="Aún no hay nada en el inbox"
            description="Cuando lleguen mensajes importantes los verás aquí. Sincroniza tus cuentas de correo para importar los mensajes recientes."
          />
        </Card>
      ) : !selected ? (
        <div className="dfy-inbox-list">
          {filtered.map((item) => (
            <Card key={item.id}>
              <header className="dfy-inbox-item__head">
                <div className="dfy-inbox-item__title">
                    <button
                      type="button"
                      className="dfy-inbox-item__open"
                      onClick={() => void openItem(item)}
                      disabled={openingId !== null}
                    >
                      <strong>{item.subject || "(Sin asunto)"}</strong>
                    </button>
                  {item.unread && <span className="dfy-dot dfy-dot--connected" aria-hidden="true" />}
                </div>
                <Badge tone={toneForCategory(item.category)}>
                  {labelForCategory(item.category)}
                </Badge>
              </header>
              <p className="dfy-muted dfy-muted--small dfy-inbox-item__from">
                De <strong>{item.sender?.email ?? item.senderEmail}</strong>
                {(item.sender?.displayName ?? item.senderName) ? ` (${item.sender?.displayName ?? item.senderName})` : ""} ·{" "}
                {new Date(item.receivedAt).toLocaleString("es-ES")}
              </p>
              <p className="dfy-inbox-item__preview">{item.preview}</p>
              {item.importance >= 0.7 && (
                <p className="dfy-inbox-item__hint">
                  Esto parece importante. Elvira puede preparar una respuesta si
                  quieres.
                </p>
              )}
              <div className="dfy-inbox-actions">
                {item.state === "in_work" ? (
                  <Badge tone="accent">En trabajo</Badge>
                ) : (
                  <button
                    type="button"
                    className="dfy-button dfy-button--small"
                    disabled={workingId !== null}
                    onClick={() => void toWork(item)}
                  >
                    {workingId === item.id ? "Creando…" : "Convertir en tarea"}
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function toneForCategory(
  category: string,
): "neutral" | "accent" | "warning" | "danger" | "success" {
  switch (category) {
    case "lead":
      return "success";
    case "customer_question":
      return "accent";
    case "support":
      return "warning";
    case "campaign_response":
      return "neutral";
    default:
      return "neutral";
  }
}

function labelForCategory(category: string): string {
  switch (category) {
    case "lead":
      return "Posible lead";
    case "customer_question":
      return "Consulta";
    case "support":
      return "Soporte";
    case "campaign_response":
      return "Campaña";
    case "administrative":
      return "Administrativo";
    default:
      return "Sin clasificar";
  }
}

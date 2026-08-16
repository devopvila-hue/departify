import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { api, type CompanyStatus, type ConnectionCardView, type LlmSettingsView } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";

/**
 * Configuración is intentionally separate from Empresa. It only exposes
 * operational states that the backend already supports; unsupported settings
 * are labelled honestly instead of being presented as editable controls.
 */
export function SettingsRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [connections, setConnections] = useState<ConnectionCardView[]>([]);
  const [llmSettings, setLlmSettings] = useState<LlmSettingsView | null>(null);
  const [llmKey, setLlmKey] = useState("");
  const [editingLlm, setEditingLlm] = useState(false);
  const [savingLlm, setSavingLlm] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    if (!organizationId) return;
    setLoadError(false);
    setLoaded(false);
    void Promise.all([
      api.status(organizationId),
      api.connections(organizationId),
      api.llmSettings(organizationId),
    ])
      .then(([company, connected, llm]) => {
        setStatus(company);
        setConnections(connected?.cards ?? []);
        setLlmSettings(llm);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, [organizationId]);

  const saveLlm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || !llmKey.trim() || savingLlm) return;
    setSavingLlm(true);
    setLlmError(null);
    const result = await api.saveLlmSettings(organizationId, {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: llmKey.trim(),
    });
    setSavingLlm(false);
    if (!result || result.error || !result.configured) {
      setLlmError(
        result?.error?.message ??
          "No hemos podido validar esta API key. Comprueba que la has copiado completa y vuelve a intentarlo.",
      );
      return;
    }
    setLlmSettings(result);
    setLlmKey("");
    setEditingLlm(false);
  };

  useEffect(() => { load(); }, [load]);

  const emailCards = connections.filter((card) => card.categoryId === "email");
  const connectedEmail = emailCards.find((card) => card.state === "connected");

  return (
    <div className="dfy-page dfy-settings-page" data-testid="settings-route">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Configuración</p>
        <h1>Preferencias operativas</h1>
        <p className="dfy-hero__lead">
          Aquí verás la configuración disponible para trabajar con tu empresa.
          La información empresarial está en Empresa.
        </p>
      </section>

      {loadError && (
        <section className="dfy-card" aria-label="Error de configuración">
          <p className="dfy-alert" role="alert">No he podido cargar la configuración de tu empresa.</p>
          <button type="button" className="dfy-button" onClick={load}>Reintentar</button>
        </section>
      )}

      <Card title="Identidad de la empresa">
        <dl className="dfy-facts">
          <div>
            <dt>Nombre de la empresa</dt>
            <dd>{status?.companyName ?? (loaded ? "No disponible" : "Cargando…")}</dd>
          </div>
          <div>
            <dt>Logo y branding</dt>
            <dd><Badge tone="neutral">Todavía no disponible</Badge></dd>
          </div>
        </dl>
      </Card>

      <Card title="Correo de empresa">
        {connectedEmail ? (
          <dl className="dfy-facts">
            <div><dt>Cuenta conectada</dt><dd>{connectedEmail.name}</dd></div>
            <div><dt>Estado</dt><dd><Badge tone="success">Conectado</Badge></dd></div>
          </dl>
        ) : (
          <EmptyState
            title="No hay un correo operativo"
            description="Gestiona la conexión de correo desde Conexiones. El remitente, firma y nombre se mostrarán aquí cuando exista esa configuración."
          />
        )}
      </Card>

      <Card title="Claves API y capacidades">
        <div className="dfy-settings-capability" data-testid="llm-settings">
          <p className="dfy-eyebrow">Capacidad</p>
          <h3>Razonamiento de Departify</h3>
          <p className="dfy-card__description">
            Puedes usar tu propia cuenta de OpenAI para que Departify trabaje con la capacidad de IA de tu empresa.
          </p>
          {llmSettings?.configured && !editingLlm ? (
            <div className="dfy-settings-capability__status">
              <Badge tone="success">Conectado</Badge>
              <span>{llmSettings.providerName} · {llmSettings.modelLabel}</span>
              <button type="button" className="dfy-button dfy-button--ghost" onClick={() => setEditingLlm(true)}>
                Cambiar clave
              </button>
            </div>
          ) : (
            <form className="dfy-settings-capability__form" onSubmit={saveLlm}>
              <label>
                Proveedor
                <select value="openai" disabled aria-label="Proveedor">
                  <option value="openai">OpenAI</option>
                </select>
              </label>
              <label>
                Modelo
                <select value="gpt-4o-mini" disabled aria-label="Modelo">
                  <option value="gpt-4o-mini">Recomendado — GPT-4o mini</option>
                </select>
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={llmKey}
                  onChange={(event) => setLlmKey(event.target.value)}
                  placeholder="Pega aquí tu API key"
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-label="API key"
                  required
                />
              </label>
              <p className="dfy-card__description">
                Crea una clave en la página oficial y pégala aquí. Departify la guardará de forma segura y comprobará que funciona.
              </p>
              <div className="dfy-settings-capability__links">
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
                  Obtener API key ↗
                </a>
                <a href="https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key" target="_blank" rel="noopener noreferrer">
                  Ver guía oficial ↗
                </a>
              </div>
              {llmError && <p className="dfy-alert" role="alert">{llmError}</p>}
              <button type="submit" className="dfy-button" disabled={savingLlm || !llmKey.trim()}>
                {savingLlm ? "Comprobando…" : "Guardar y comprobar"}
              </button>
            </form>
          )}
        </div>
        <button type="button" className="dfy-button dfy-button--ghost" onClick={() => navigate("/conexiones")}>
          Gestionar conexiones
        </button>
      </Card>

      <Card title="Notificaciones">
        <EmptyState
          title="Preferencias no disponibles todavía"
          description="Departify aún no tiene preferencias de notificaciones editables en esta empresa."
        />
      </Card>

      <Card title="WhatsApp Business">
        <EmptyState
          title="No conectado"
          description="La conexión de WhatsApp Business todavía no está disponible. No se utiliza WhatsApp Web ni un iframe."
        />
      </Card>
    </div>
  );
}

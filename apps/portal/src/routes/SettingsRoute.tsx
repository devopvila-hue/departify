import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type CompanyStatus, type ConnectionCardView } from "@/app/api";
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
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    if (!organizationId) return;
    setLoadError(false);
    setLoaded(false);
    void Promise.all([api.status(organizationId), api.connections(organizationId)])
      .then(([company, connected]) => {
        setStatus(company);
        setConnections(connected?.cards ?? []);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, [organizationId]);

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

      <Card title="Claves de servicios">
        <EmptyState
          title="No hay claves adicionales que configurar"
          description="Las conexiones disponibles se gestionan desde Conexiones. Cuando un servicio admita una clave propia, podrás obtenerla con instrucciones oficiales. Nunca se muestran secretos en el portal."
        />
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

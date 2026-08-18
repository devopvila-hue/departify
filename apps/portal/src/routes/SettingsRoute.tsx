/**
 * /configuracion — Operative preferences for the current organization.
 *
 * This screen exposes ONLY what the backend actually operates:
 *
 *   - Branding — durable logo + brand name (Supabase Storage private).
 *   - IA de tu empresa — multi-provider BYOK with real provider validation.
 *
 * Provider/model dropdowns are driven by the canonical server-side
 * registry; the portal never hardcodes a fictitious list. Credentials are
 * stored server-side; the API key NEVER returns to the client after the
 * initial save.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";

import {
  api,
  type BrandingView,
  type ByokProviderView,
  type CompanyStatus,
  type ConnectionCardView,
  type LlmSettingsView,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";

const ALLOWED_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

type CapabilityState =
  | { phase: "loading" }
  | { phase: "ready" }
  | { phase: "saving" }
  | { phase: "removing" }
  | { phase: "error"; message: string };

export function SettingsRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [connections, setConnections] = useState<ConnectionCardView[]>([]);
  const [llmSettings, setLlmSettings] = useState<LlmSettingsView | null>(null);
  const [providers, setProviders] = useState<ByokProviderView[]>([]);
  const [branding, setBranding] = useState<BrandingView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [providerId, setProviderId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [capability, setCapability] = useState<CapabilityState>({ phase: "loading" });
  const [editingCapability, setEditingCapability] = useState(false);

  const [brandName, setBrandName] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoFileName, setLogoFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(() => {
    if (!organizationId) return;
    setLoadError(false);
    setLoaded(false);
    void Promise.all([
      api.status(organizationId),
      api.connections(organizationId),
      api.llmSettings(organizationId),
      api.byokProviders(organizationId),
      api.branding(organizationId),
    ])
      .then(([company, connected, llm, registry, brand]) => {
        setStatus(company);
        setConnections(connected?.cards ?? []);
        setLlmSettings(llm);
        const enabledProviders = registry?.providers ?? [];
        setProviders(enabledProviders);
        const currentProvider =
          enabledProviders.find((p) => p.id === llm?.provider) ??
          enabledProviders[0] ??
          null;
        if (currentProvider) {
          setProviderId((prev) => prev || currentProvider.id);
          const currentModel =
            currentProvider.models.find((m) => m.id === llm?.model) ??
            currentProvider.models.find((m) => m.recommended) ??
            currentProvider.models[0] ??
            null;
          if (currentModel) setModelId((prev) => prev || currentModel.id);
        }
        setBranding(brand ?? null);
        setBrandName(brand?.brandName ?? "");
        setCapability({ phase: "ready" });
        setEditingCapability(!llm?.configured);
      })
      .catch(() => {
        setLoadError(true);
        setCapability({ phase: "error", message: "No hemos podido cargar la configuración." });
      })
      .finally(() => setLoaded(true));
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);

  const providerDescriptor = useMemo<ByokProviderView | null>(
    () => providers.find((p) => p.id === providerId) ?? null,
    [providers, providerId],
  );
  const modelDescriptor = useMemo(() => {
    if (!providerDescriptor) return null;
    return providerDescriptor.models.find((m) => m.id === modelId) ?? null;
  }, [providerDescriptor, modelId]);

  useEffect(() => {
    if (!providerDescriptor) return;
    const firstRecommended =
      providerDescriptor.models.find((m) => m.recommended) ??
      providerDescriptor.models[0] ??
      null;
    if (firstRecommended && !providerDescriptor.models.some((m) => m.id === modelId)) {
      setModelId(firstRecommended.id);
    }
  }, [providerDescriptor, modelId]);

  const saveLlm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || capability.phase === "saving") return;
    if (!providerDescriptor || !modelDescriptor) return;
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      setCapability({
        phase: "error",
        message: "Introduce una API key para continuar.",
      });
      return;
    }
    setCapability({ phase: "saving" });
    const result = await api.saveLlmSettings(organizationId, {
      provider: providerDescriptor.id,
      model: modelDescriptor.id,
      apiKey: trimmedKey,
      ...(providerDescriptor.requiresBaseUrl && baseUrl.trim().length > 0
        ? { baseUrl: baseUrl.trim() }
        : {}),
    });
    if (!result || result.error || !result.configured) {
      setCapability({
        phase: "error",
        message:
          result?.error?.message ??
          "No hemos podido validar esta API key. Comprueba que la has copiado completa y vuelve a intentarlo.",
      });
      return;
    }
    setCapability({ phase: "ready" });
    setLlmSettings(result);
    setApiKey("");
    setEditingCapability(false);
  };

  const removeLlm = async () => {
    if (!organizationId || capability.phase === "removing") return;
    setCapability({ phase: "removing" });
    const result = await api.deleteLlmSettings(organizationId);
    if (!result || result.error) {
      setCapability({
        phase: "error",
        message:
          result?.error?.message ??
          "No hemos podido eliminar la clave. Inténtalo de nuevo.",
      });
      return;
    }
    setCapability({ phase: "ready" });
    setLlmSettings(null);
    setEditingCapability(true);
  };

  const onPickLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!organizationId) return;
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoError(null);
    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.type as typeof ALLOWED_LOGO_MIME_TYPES[number])) {
      setLogoError("Formato no soportado. Usa PNG, JPG o WEBP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("El archivo es demasiado grande (máximo 5 MB).");
      return;
    }
    setLogoUploading(true);
    setLogoFileName(file.name);
    try {
      const dataBase64 = await readAsBase64(file);
      const result = await api.uploadBrandingLogo(organizationId, {
        mimeType: file.type,
        dataBase64,
        fileName: file.name,
      });
      if (!result || result.error) {
        setLogoError(
          result?.error?.message ?? "No hemos podido subir el logo. Inténtalo de nuevo.",
        );
        return;
      }
      setBranding(result);
    } catch (cause) {
      setLogoError(
        cause instanceof Error
          ? cause.message
          : "No hemos podido leer el archivo. Inténtalo de nuevo.",
      );
    } finally {
      setLogoUploading(false);
    }
  };

  const removeLogo = async () => {
    if (!organizationId || logoUploading) return;
    setLogoError(null);
    setLogoUploading(true);
    try {
      const result = await api.deleteBrandingLogo(organizationId);
      if (!result || result.error) {
        setLogoError(
          result?.error?.message ?? "No hemos podido eliminar el logo.",
        );
        return;
      }
      setBranding(result);
      setLogoFileName(null);
    } finally {
      setLogoUploading(false);
    }
  };

  const saveBrandName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) return;
    const result = await api.updateBrandingName(organizationId, {
      brandName: brandName.trim().length > 0 ? brandName.trim() : null,
    });
    if (!result || result.error) {
      setLogoError(result?.error?.message ?? "No hemos podido guardar el nombre de marca.");
      return;
    }
    setBranding(result);
  };

  const emailCards = connections.filter((card) => card.categoryId === "email");
  const connectedEmail = emailCards.find((card) => card.state === "connected");

  const llmHelp = llmSettings?.help ?? null;
  const capabilityReady = capability.phase === "ready" || capability.phase === "saving" || capability.phase === "removing";

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
            <dt>Nombre de la marca</dt>
            <dd>{branding?.brandName ?? "—"}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Logo y branding">
        <div className="dfy-settings-branding" data-testid="branding-section">
          {branding?.logo ? (
            <div className="dfy-settings-branding__preview">
              <img
                src={branding.logo.signedUrl}
                alt={brandName.trim().length > 0 ? `Logo de ${brandName}` : "Logo de la empresa"}
                className="dfy-settings-branding__image"
              />
              <dl className="dfy-facts">
                <div>
                  <dt>Formato</dt>
                  <dd>{branding.logo.mimeType}</dd>
                </div>
                <div>
                  <dt>Tamaño</dt>
                  <dd>{formatBytes(branding.logo.sizeBytes)}</dd>
                </div>
                {branding.updatedAt ? (
                  <div>
                    <dt>Actualizado</dt>
                    <dd>{formatDate(branding.updatedAt)}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : (
            <EmptyState
              title="Logo de tu empresa"
              description="Añade tu logo para personalizar Departify."
            />
          )}

          <div className="dfy-settings-branding__actions">
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_LOGO_MIME_TYPES.join(",")}
              onChange={onPickLogo}
              data-testid="branding-logo-input"
              className="dfy-settings-branding__file"
              aria-label="Subir logo"
            />
            <button
              type="button"
              className="dfy-button"
              onClick={() => fileInputRef.current?.click()}
              disabled={logoUploading}
            >
              {logoUploading
                ? "Subiendo…"
                : branding?.logo
                  ? "Reemplazar logo"
                  : "Subir logo"}
            </button>
            {branding?.logo ? (
              <button
                type="button"
                className="dfy-button dfy-button--ghost"
                onClick={removeLogo}
                disabled={logoUploading}
              >
                Eliminar
              </button>
            ) : null}
            {logoFileName ? (
              <span className="dfy-card__description" aria-live="polite">
                {logoFileName}
              </span>
            ) : null}
          </div>

          <form
            className="dfy-settings-branding__name"
            onSubmit={saveBrandName}
          >
            <label htmlFor="dfy-brand-name">Nombre de la marca</label>
            <div className="dfy-settings-branding__namerow">
              <input
                id="dfy-brand-name"
                type="text"
                value={brandName}
                maxLength={80}
                onChange={(event) => setBrandName(event.target.value)}
                placeholder="Cómo quieres que se vea el nombre en Departify"
              />
              <button type="submit" className="dfy-button dfy-button--ghost">
                Guardar nombre
              </button>
            </div>
          </form>

          {logoError ? (
            <p className="dfy-alert" role="alert">{logoError}</p>
          ) : null}
        </div>
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

      <Card title="IA de tu empresa">
        <div className="dfy-settings-capability" data-testid="llm-settings">
          <p className="dfy-card__description">
            Usa tu propia cuenta si quieres que Departify trabaje con tu proveedor.
            Si no configuras nada, Departify sigue funcionando con su configuración por defecto.
          </p>

          {llmSettings?.configured && !editingCapability ? (
            <div className="dfy-settings-capability__status" data-testid="llm-status">
              <Badge tone={capabilityReady ? "success" : "neutral"}>
                {capabilityReady ? "Conectado" : "Pendiente"}
              </Badge>
              <span>
                {llmSettings.providerName} · {llmSettings.modelLabel}
              </span>
              {llmSettings.verifiedAt ? (
                <span className="dfy-card__description">
                  Validado: {formatDate(llmSettings.verifiedAt)}
                </span>
              ) : null}
              <button
                type="button"
                className="dfy-button dfy-button--ghost"
                onClick={() => setEditingCapability(true)}
              >
                Cambiar
              </button>
              <button
                type="button"
                className="dfy-button dfy-button--ghost"
                onClick={removeLlm}
                disabled={capability.phase === "removing"}
              >
                {capability.phase === "removing" ? "Eliminando…" : "Eliminar"}
              </button>
            </div>
          ) : (
            <form className="dfy-settings-capability__form" onSubmit={saveLlm}>
              <label>
                Proveedor
                <select
                  value={providerId}
                  onChange={(event) => setProviderId(event.target.value)}
                  aria-label="Proveedor"
                  data-testid="provider-select"
                  disabled={providers.length === 0 || capability.phase === "saving"}
                >
                  {providers.length === 0 ? (
                    <option value="">No hay proveedores disponibles</option>
                  ) : null}
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Modelo
                <select
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  aria-label="Modelo"
                  data-testid="model-select"
                  disabled={!providerDescriptor || capability.phase === "saving"}
                >
                  {(providerDescriptor?.models ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                API key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={llmHelp?.apiKeyPlaceholder ?? "sk-…"}
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-label="API key"
                  data-testid="api-key-input"
                  required
                />
              </label>

              {providerDescriptor?.requiresBaseUrl ? (
                <label>
                  Endpoint
                  <input
                    type="url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                    aria-label="Endpoint"
                    spellCheck={false}
                  />
                </label>
              ) : null}

              <p className="dfy-card__description">
                Crea una clave en la página oficial y pégala aquí. Departify la guardará de forma segura y comprobará que funciona.
              </p>

              {llmHelp ? (
                <div className="dfy-settings-capability__links">
                  <a href={llmHelp.actionUrl} target="_blank" rel="noopener noreferrer">
                    Obtener API key ↗
                  </a>
                  <a href={llmHelp.docsUrl} target="_blank" rel="noopener noreferrer">
                    Guía oficial ↗
                  </a>
                </div>
              ) : null}

              {capability.phase === "error" ? (
                <p className="dfy-alert" role="alert">{capability.message}</p>
              ) : null}

              <button
                type="submit"
                className="dfy-button"
                disabled={capability.phase === "saving" || !apiKey.trim() || !providerDescriptor || !modelDescriptor}
              >
                {capability.phase === "saving" ? "Comprobando…" : "Guardar y comprobar"}
              </button>
            </form>
          )}
        </div>
        <button
          type="button"
          className="dfy-button dfy-button--ghost"
          onClick={() => navigate("/conexiones")}
        >
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

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No hemos podido leer el archivo."));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Formato de archivo no soportado."));
        return;
      }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

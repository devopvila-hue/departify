import { useCallback, useEffect, useState } from "react";

import { api, type DepartmentResult, type SeoResultContract } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState, HeadBadge } from "@/components/primitives";
import { DepartmentWorkspaceNav } from "@/components/DepartmentWorkspaceNav";
import { SeoDashboard } from "@/components/SeoDashboard";

/**
 * Extract the canonical SEO Result contract from a DepartmentResult.
 * Returns null when the result is not a canonical SEO contract (e.g.
 * a different capability produced it). The Portal treats null as "no
 * SEO dashboard to render" and falls back to the raw result card.
 */
function extractSeoContract(
  result: DepartmentResult | null,
): SeoResultContract | null {
  if (!result) return null;
  const data = result.data;
  if (!data || typeof data !== "object") return null;
  const candidate = (data as { seoContract?: unknown }).seoContract;
  if (!candidate || typeof candidate !== "object") return null;
  const obj = candidate as { contract?: unknown; version?: unknown };
  if (obj.contract !== "seo.audit.result") return null;
  if (obj.version !== 1) return null;
  return candidate as SeoResultContract;
}

export function SeoRoute() {
  const { organizationId } = useOrg();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.seoDepartment>>>(null);
  const [result, setResult] = useState<DepartmentResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repositoryBusy, setRepositoryBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const next = await api.seoDepartment(organizationId);
      if (next) {
        setData(next);
        setError(null);
      } else {
        setError("No he podido cargar el estado de SEO ahora mismo.");
      }
    } catch {
      setError("No he podido cargar el estado de SEO ahora mismo.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function runAudit() {
    if (!organizationId) return;
    setRunning(true);
    setError(null);
    const audit = await api.seoAudit(organizationId);
    if (!audit?.result) {
      setError("No he podido completar la auditoría. Revisa la web configurada e inténtalo de nuevo.");
    } else {
      // Surface the persisted DepartmentResult so the dashboard renders
      // the canonical contract (structured payload), not just markdown.
      setResult(audit.result);
    }
    await load();
    setRunning(false);
  }

  async function connectRepository() {
    if (!organizationId) return;
    setRepositoryBusy(true);
    const result = await api.connect(organizationId, "github_repository");
    const authorizationUrl = result?.connection?.authorizationUrl;
    if (authorizationUrl) {
      window.location.href = authorizationUrl;
      return;
    }
    setError(result?.connection?.blockedReason ?? "No he podido iniciar la conexión del proyecto.");
    setRepositoryBusy(false);
  }

  async function selectRepository(repository: { id: string; fullName: string; defaultBranch: string }) {
    if (!organizationId) return;
    setRepositoryBusy(true);
    const result = await api.seoRepository(organizationId, {
      repositoryId: repository.id,
      repositoryFullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
    });
    if (!result?.repository) setError("No he podido asociar este proyecto con la web.");
    await load();
    setRepositoryBusy(false);
  }

  const seoContract = extractSeoContract(result);

  return (
    <div className="dfy-page">
      <section className="dfy-hero dfy-hero--department">
        <p className="dfy-eyebrow">Departamento</p>
        <h1>SEO</h1>
        <HeadBadge head={{ departmentId: "seo", department: "SEO", name: "Responsable de SEO", initials: "SEO", role: "Responsable de SEO" }} />
        <DepartmentWorkspaceNav departmentId="seo" />
        <p className="dfy-hero__goal">Mejorar la web con problemas verificables y trabajo priorizado.</p>
      </section>
      {error && <p className="dfy-alert" role="alert">{error}</p>}
      {!data && loading ? <Card><p className="dfy-muted">Cargando SEO…</p></Card> : !data ? <Card><p className="dfy-alert" role="alert">No he podido cargar el estado de SEO ahora mismo.</p><button type="button" className="dfy-button" onClick={() => void load()}>Reintentar</button></Card> : (
        <>
          <Card title="Estado de SEO" action={<Badge tone={data.state === "ready" ? "success" : "warning"}>{data.state === "ready" ? "Listo para revisar" : data.state === "web_detected" ? "Web detectada" : "Necesita configuración"}</Badge>}>
            {data.website ? <p>Hemos detectado tu web: <strong>{data.website}</strong></p> : <EmptyState title="Indica la web de tu empresa" description="SEO necesita una web real para poder revisar títulos, estructura, enlaces y accesibilidad básica." />}
            {data.website && !data.repository && (
              <div className="dfy-seo-onboarding" role="status">
                <strong>{data.onboarding.repositoryConnected ? "Selecciona el proyecto de tu web" : "Conecta el proyecto de tu web"}</strong>
                <p className="dfy-muted">La auditoría pública funciona ya. Con el proyecto conectado, SEO podrá localizar los archivos que deben corregirse.</p>
                {!data.onboarding.repositoryConnected ? (
                  <div className="dfy-seo-onboarding__actions">
                    <button type="button" className="dfy-button" disabled={repositoryBusy} onClick={() => void connectRepository()}>{repositoryBusy ? "Conectando…" : "Conectar proyecto"}</button>
                    <button type="button" className="dfy-button dfy-button--ghost" onClick={() => void setError("Puedes conectar el proyecto más tarde desde SEO.")}>Ahora no</button>
                  </div>
                ) : (
                  <select aria-label="Proyecto de la web" disabled={repositoryBusy || data.repositories.length === 0} defaultValue="" onChange={(event) => { const repository = data.repositories.find((item) => item.id === event.target.value); if (repository) void selectRepository(repository); }}>
                    <option value="">Selecciona el proyecto</option>
                    {data.repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.fullName}{repository.private ? " · privado" : ""}</option>)}
                  </select>
                )}
              </div>
            )}
            {data.repository && <p className="dfy-muted">Proyecto conectado: <strong>{data.repository.repositoryFullName}</strong> · Lectura disponible · Cambios requieren autorización.</p>}
            <div className="dfy-seo-capabilities"><span>Auditoría web {data.capabilities.websiteAudit ? "disponible" : "pendiente"}</span><span>Proyecto web {data.capabilities.repositoryRead ? "conectado" : "pendiente"}</span><span>Search Console {data.capabilities.searchConsole ? "conectado" : "pendiente de conexión"}</span><span>Analytics {data.capabilities.analytics ? "conectado" : "pendiente de conexión"}</span></div>
            <button type="button" className="dfy-button" disabled={!data.capabilities.websiteAudit || running} onClick={() => void runAudit()}>{running ? "Revisando la web…" : "Revisar el SEO de nuestra web"}</button>
          </Card>
          <Card title="Capacidades del equipo">
            <ul className="dfy-list">{data.capabilities.roster.map((capability) => <li key={capability.id}><span><strong>{capability.label}</strong><span className="dfy-muted dfy-muted--small">{capability.description}</span></span><Badge tone={capability.state === "disponible" ? "success" : capability.state === "necesita_conexion" ? "warning" : "neutral"}>{capability.state === "disponible" ? "Disponible" : capability.state === "necesita_conexion" ? "Necesita conexión" : "No disponible"}</Badge></li>)}</ul>
          </Card>
          {seoContract ? <SeoDashboard contract={seoContract} /> : result ? <SeoReport report={result} /> : null}
          <Card title="Trabajo SEO">
            {data.tasks.length === 0 ? <EmptyState title="Todavía no hay trabajo SEO" description="Cuando inicies una revisión, la tarea y su progreso quedarán aquí de forma durable." /> : <ul className="dfy-list">{data.tasks.map((task) => <li key={task.id}><strong>{task.title}</strong><span className="dfy-muted">{task.statusMessage}</span><Badge tone={task.status === "completed" ? "success" : task.status === "failed" ? "danger" : "accent"}>{task.status}</Badge></li>)}</ul>}
          </Card>
          <Card title="Resultados SEO">
            {data.results.length === 0 ? <EmptyState title="Sin resultados todavía" description="La auditoría terminará en Resultados para poder revisarla más adelante." /> : <ul className="dfy-list">{data.results.map((result) => <li key={result.id}><strong>{result.title}</strong><span className="dfy-muted">{result.summary}</span></li>)}</ul>}
          </Card>
        </>
      )}
    </div>
  );
}

function SeoReport(props: { report: DepartmentResult }) {
  // Fallback rendering when the persisted result does not carry the
  // canonical SEO contract. Keeps the raw markdown body viewable.
  return (
    <Card title={`Resultado ${props.report.title}`}>
      <p className="dfy-muted">{props.report.summary}</p>
      <pre className="dfy-muted">{props.report.content.slice(0, 600)}</pre>
    </Card>
  );
}
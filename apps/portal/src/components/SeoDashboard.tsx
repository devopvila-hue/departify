/**
 * SEO dashboard — Customer Zero Golden Image.
 *
 * Renders the canonical `SeoResultContract` produced by the backend's
 * `runDelegateSeoTurn`. The Portal reads `result.data.seoContract` from
 * the canonical `DepartmentResult` and renders:
 *
 *   - Header (URL auditada, fecha, estado)
 *   - Resumen (Críticos / Importantes / Oportunidades / Resueltos)
 *   - Lista de problemas priorizada (severidad, evidencia, recomendación,
 *     archivo probable cuando exista)
 *   - Plan de resolución (Ahora / Después / Optimización)
 *   - Correlación Web ↔ Repositorio (OBSERVADO / INFERENCIA / RECOMENDACIÓN)
 *
 * No inventa scores. Los números vienen exclusivamente del
 * `SeoAuditReport` observado. Las inferencias nunca se presentan
 * como hechos: cada bloque lleva etiqueta visible de su origen.
 */
import { Badge, Card } from "./primitives";
import type { SeoResultContract } from "@/app/api";

const SEVERITY_LABEL = {
  critical: { label: "Crítico", tone: "danger" as const },
  important: { label: "Importante", tone: "warning" as const },
  opportunity: { label: "Oportunidad", tone: "neutral" as const },
};

const PHASE_LABEL = {
  now: { title: "Ahora", tone: "danger" as const, summary: "Problemas que bloquean la indexación y el rastreo." },
  next: { title: "Después", tone: "warning" as const, summary: "Problemas importantes de metadata y estructura." },
  later: { title: "Optimización", tone: "neutral" as const, summary: "Oportunidades detectadas para mejorar accesibilidad y presentación." },
};

export function SeoDashboard(props: { contract: SeoResultContract }) {
  const { contract } = props;
  const sortedIssues = [...contract.issues].sort((a, b) => {
    const order = { critical: 0, important: 1, opportunity: 2 } as const;
    return order[a.severity] - order[b.severity];
  });

  return (
    <div className="dfy-seo-dashboard" data-testid="seo-dashboard">
      <Card title="Auditoría SEO">
        <p className="dfy-muted">Web auditada: <strong>{contract.url}</strong></p>
        <p className="dfy-muted">Fecha: {new Date(contract.fetchedAt).toLocaleString()}</p>
        <p className="dfy-muted">
          Estado: <strong>{contract.issues.length === 0 ? "Sin hallazgos" : "Auditoría completada"}</strong>
        </p>
      </Card>

      <Card title="Resumen">
        <div className="dfy-dashboard-kpis">
          <div className="dfy-dashboard-kpi"><span>Críticos</span><strong>{contract.plan.totals.critical}</strong></div>
          <div className="dfy-dashboard-kpi"><span>Importantes</span><strong>{contract.plan.totals.important}</strong></div>
          <div className="dfy-dashboard-kpi"><span>Oportunidades</span><strong>{contract.plan.totals.opportunity}</strong></div>
          <div className="dfy-dashboard-kpi"><span>Total problemas</span><strong>{contract.issues.length}</strong></div>
        </div>
      </Card>

      <Card title="Problemas priorizados">
        {sortedIssues.length === 0 ? (
          <p className="dfy-muted">No se han encontrado problemas verificables en la auditoría.</p>
        ) : (
          <ol className="dfy-list dfy-list--numbered">
            {sortedIssues.map((issue) => (
              <li key={issue.id} className={`dfy-issue dfy-issue--${issue.severity}`}>
                <div className="dfy-issue__head">
                  <Badge tone={SEVERITY_LABEL[issue.severity].tone}>
                    {SEVERITY_LABEL[issue.severity].label}
                  </Badge>
                  <strong>{issue.title}</strong>
                </div>
                <p className="dfy-issue__provenance">
                  <strong>OBSERVADO (web):</strong> {issue.evidence}
                </p>
                {issue.repositoryFiles.length > 0 && (
                  <p className="dfy-issue__provenance">
                    <strong>OBSERVADO (repo):</strong>{" "}
                    {issue.repositoryFiles.map((file, idx) => (
                      <span key={file}>
                        {idx > 0 ? ", " : ""}
                        <code>{file}</code>
                      </span>
                    ))}
                  </p>
                )}
                <p className="dfy-issue__provenance">
                  <strong>RECOMENDACIÓN:</strong> {issue.recommendation}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="Plan de resolución">
        <ol className="dfy-plan">
          {contract.plan.buckets.map((bucket) => (
            <li key={bucket.phase} className={`dfy-plan__bucket dfy-plan__bucket--${bucket.phase}`}>
              <div className="dfy-plan__head">
                <Badge tone={PHASE_LABEL[bucket.phase].tone}>{PHASE_LABEL[bucket.phase].title}</Badge>
                <strong>{bucket.summary}</strong>
              </div>
              <p className="dfy-muted">
                {bucket.issueIds.length === 0
                  ? "Sin acciones en esta fase."
                  : `${bucket.issueIds.length} problema${bucket.issueIds.length === 1 ? "" : "s"} agrupado${bucket.issueIds.length === 1 ? "" : "s"}.`}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      {contract.correlation.sections.length > 0 && (
        <Card title="Web ↔ Repositorio — correlación">
          {contract.correlation.repository ? (
            <p className="dfy-muted">
              Repositorio: <strong>{contract.correlation.repository.fullName}</strong> ({contract.correlation.repository.htmlUrl})
            </p>
          ) : null}
          <ol className="dfy-list">
            {contract.correlation.sections.map((section) => (
              <li key={section.issueId}>
                <strong>{section.title}</strong>
                <p><strong>OBSERVADO (web):</strong> {section.observedWebEvidence}</p>
                {section.observedRepositoryFiles.length > 0 && (
                  <p>
                    <strong>OBSERVADO (repo):</strong>{" "}
                    {section.observedRepositoryFiles.map((file, idx) => (
                      <span key={file}>{idx > 0 ? ", " : ""}<code>{file}</code></span>
                    ))}
                  </p>
                )}
                <p><strong>INFERENCIA:</strong> {section.inference}</p>
                <p><strong>RECOMENDACIÓN:</strong> {section.recommendation}</p>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
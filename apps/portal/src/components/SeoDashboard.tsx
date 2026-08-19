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
import type { DepartmentTask, SeoResultContract } from "@/app/api";

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

export function SeoDashboard(props: {
  contract: SeoResultContract;
  derivedTasks?: readonly DepartmentTask[];
}) {
  const { contract, derivedTasks = [] } = props;
  const issuesList = contract?.issues || [];
  const sortedIssues = [...issuesList].sort((a, b) => {
    const order = { critical: 0, important: 1, opportunity: 2 } as const;
    const priorityA = order[a?.severity as keyof typeof order] ?? 99;
    const priorityB = order[b?.severity as keyof typeof order] ?? 99;
    return priorityA - priorityB;
  });

  // Index derived tasks by the issues they cover so the plan buckets
  // show their live state (queued / running / completed / failed).
  const tasksByPhase: Record<string, DepartmentTask[]> = { now: [], next: [], later: [] };
  for (const task of derivedTasks) {
    const phaseMatch = contract?.tasks?.find((payload) => payload.title === task.title);
    if (phaseMatch) {
      const bucket = tasksByPhase[phaseMatch.phase];
      if (bucket) {
        bucket.push(task);
      }
    }
  }

  // Derive "Resueltos" from the live task list — never from a fake score.
  const resolvedCount = derivedTasks.filter(
    (t) => t.status === "completed",
  ).length;

  return (
    <div className="dfy-seo-dashboard" data-testid="seo-dashboard">
      <Card title="Auditoría SEO">
        <p className="dfy-muted">Web auditada: <strong>{contract?.url || "URL desconocida"}</strong></p>
        <p className="dfy-muted">Fecha: {contract?.fetchedAt ? new Date(contract.fetchedAt).toLocaleString() : "Fecha desconocida"}</p>
        <p className="dfy-muted">
          Estado: <strong>{issuesList.length === 0 ? "Sin hallazgos verificables" : "Auditoría completada"}</strong>
        </p>
        {issuesList.length === 0 && (
          <p className="dfy-muted">
            Revisamos title, description, canonical, robots, encabezados, enlaces
            internos, imágenes, datos estructurados, metadata social y sitemap. No
            encontramos problemas con la configuración observada de tu web.
          </p>
        )}
      </Card>

      <Card title="Resumen">
        <div className="dfy-dashboard-kpis">
          <div className="dfy-dashboard-kpi"><span>Críticos</span><strong>{contract?.plan?.totals?.critical ?? 0}</strong></div>
          <div className="dfy-dashboard-kpi"><span>Importantes</span><strong>{contract?.plan?.totals?.important ?? 0}</strong></div>
          <div className="dfy-dashboard-kpi"><span>Oportunidades</span><strong>{contract?.plan?.totals?.opportunity ?? 0}</strong></div>
          <div className="dfy-dashboard-kpi"><span>Resueltos</span><strong>{resolvedCount}</strong></div>
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
          {(contract?.plan?.buckets || []).map((bucket) => {
            const phaseInfo = PHASE_LABEL[bucket.phase as keyof typeof PHASE_LABEL] || { title: bucket.phase, tone: "neutral" };
            const tasksList = tasksByPhase[bucket.phase] || [];
            return (
              <li key={bucket.phase} className={`dfy-plan__bucket dfy-plan__bucket--${bucket.phase}`}>
                <div className="dfy-plan__head">
                  <Badge tone={phaseInfo.tone}>{phaseInfo.title}</Badge>
                  <strong>{bucket.summary}</strong>
                </div>
                <p className="dfy-muted">
                  {bucket.issueIds.length === 0
                    ? "Sin acciones en esta fase."
                    : `${bucket.issueIds.length} problema${bucket.issueIds.length === 1 ? "" : "s"} agrupado${bucket.issueIds.length === 1 ? "" : "s"}.`}
                </p>
                {tasksList.length > 0 && (
                  <ul className="dfy-plan__tasks">
                    {tasksList.map((task) => (
                      <li key={task.id} className="dfy-plan__task">
                        <strong>{task.title}</strong>
                        <Badge tone={task.status === "completed" ? "success" : task.status === "failed" ? "danger" : "accent"}>
                          {task.status === "completed" ? "Resuelto" : task.status === "failed" ? "Fallido" : task.status === "running" ? "En progreso" : "Pendiente"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      </Card>

      {contract?.correlation?.sections && contract.correlation.sections.length > 0 && (
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
                {section.observedRepositoryFiles && section.observedRepositoryFiles.length > 0 && (
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
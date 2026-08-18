import { useEffect, useMemo, useState } from "react";

import {
  api,
  type CeoOverview,
  type DepartmentResult,
  type DepartmentTask,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Card, EmptyState } from "@/components/primitives";
import { ResultRenderer } from "@/components/ResultRenderer";

/**
 * Resultados — what your company has achieved, not what the system ran.
 *
 * This route is the canonical Resultados surface. It uses the FULL
 * DepartmentResult list (`api.results(org).results`) — every entry has
 * its structured `data` payload preserved. The CeoOverview projection
 * is intentionally NOT used here because it drops the data field and
 * pins every result to the Marketing head.
 *
 * Per-result rendering is delegated to <ResultRenderer /> which
 * dispatches on `result.contract`:
 *   seo.audit.result  → <SeoDashboard />
 *   otherwise         → clean generic card (NO raw Markdown)
 *
 * Result versioning: same org + same departmentId + same contract key
 * is treated as the same operational result. The latest result per key
 * is the active one; the rest live under "Historial". We do NOT
 * create a new card per CEO re-run.
 */
export function ResultsRoute() {
  const { organizationId } = useOrg();
  const [overview, setOverview] = useState<CeoOverview | null>(null);
  const [results, setResults] = useState<DepartmentResult[]>([]);
  const [tasks, setTasks] = useState<DepartmentTask[]>([]);
  const [dashboardCount, setDashboardCount] = useState(0);
  const [dashboardLimit, setDashboardLimit] = useState(5);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    Promise.all([
      api.overview(organizationId).then((data) => {
        if (data) setOverview(data);
      }),
      api.results(organizationId).then((data) => {
        if (data) {
          setResults(data.results ?? []);
          setDashboardCount(data.dashboardCount ?? 0);
          setDashboardLimit(data.dashboardLimit ?? 5);
        }
      }),
      api.workFeed(organizationId).then((data) => {
        if (data?.tasks) setTasks(data.tasks);
      }),
    ]).finally(() => setLoading(false));
  }, [organizationId]);

  // Group results by (departmentId, contract). Latest per group is
  // active; older are history.
  const grouped = useMemo(() => groupResultsByOperationalKey(results), [results]);

  // Index tasks by id for fast lookup by ResultRenderer / SeoDashboard.
  const taskIndex = useMemo(() => {
    const map = new Map<string, DepartmentTask>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Resultados</p>
        <h1>Lo que ha conseguido tu empresa</h1>
        {overview?.goal && (
          <p className="dfy-hero__goal">
            Para: <strong>{overview.goal}</strong>
          </p>
        )}
        {dashboardCount === dashboardLimit - 1 && (
          <p className="dfy-note" role="status">Te queda espacio para 1 dashboard más.</p>
        )}
        {dashboardCount >= dashboardLimit && (
          <p className="dfy-note" role="status">Has alcanzado los {dashboardLimit} dashboards activos. Para crear otro, elimina uno o reutiliza/actualiza uno existente.</p>
        )}
      </section>

      {loading ? (
        <Card><p className="dfy-muted">Cargando resultados…</p></Card>
      ) : grouped.active.length === 0 ? (
        <Card>
          <EmptyState
            title="Todavía no hay entregables"
            description="En cuanto un departamento termine un trabajo, su resultado aparecerá aquí listo para usar."
          />
        </Card>
      ) : (
        <div className="dfy-grid dfy-grid--single">
          {grouped.active.map((result) => (
            <ResultRenderer key={result.id} result={result} taskIndex={taskIndex} />
          ))}
          {grouped.history.length > 0 && (
            <Card title="Historial">
              <details>
                <summary>
                  {grouped.history.length} resultado{grouped.history.length === 1 ? "" : "s"} anterior{grouped.history.length === 1 ? "" : "es"}
                </summary>
                <ul className="dfy-list">
                  {grouped.history.map((result) => (
                    <li key={result.id}>
                      <strong>{result.title}</strong>{" "}
                      <span className="dfy-muted">{result.departmentId} · {new Date(result.createdAt).toLocaleString()}</span>
                      <p className="dfy-muted">{result.summary}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Operational key: same org + same departmentId + same contract = the
 * same operational result. Re-running the audit updates the active
 * result instead of creating a duplicate card.
 */
interface GroupedResults {
  active: DepartmentResult[];
  history: DepartmentResult[];
}

function groupResultsByOperationalKey(results: DepartmentResult[]): GroupedResults {
  const byKey = new Map<string, DepartmentResult[]>();
  for (const result of results) {
    const key = resultKey(result);
    const bucket = byKey.get(key) ?? [];
    bucket.push(result);
    byKey.set(key, bucket);
  }
  const active: DepartmentResult[] = [];
  const history: DepartmentResult[] = [];
  for (const bucket of byKey.values()) {
    bucket.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (bucket[0]) active.push(bucket[0]);
    for (let i = 1; i < bucket.length; i += 1) {
      const item = bucket[i];
      if (item) history.push(item);
    }
  }
  return { active, history };
}

function resultKey(result: DepartmentResult): string {
  const contract = readContract(result);
  return `${result.departmentId}::${contract ?? "legacy"}`;
}

function readContract(result: DepartmentResult): string | null {
  const data = result.data;
  if (!data || typeof data !== "object") return null;
  const candidate = (data as { contract?: unknown }).contract;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
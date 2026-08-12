import { useEffect, useState } from "react";

import {
  api,
  type CeoOverview,
  type ChartData,
  type DepartmentResult,
} from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Card, EmptyState, HeadBadge } from "@/components/primitives";
import { readable } from "@/app/readable";
import { renderMarkdown } from "@/app/markdown";

/** Resultados — what your company has achieved, not what the system ran. */
export function ResultsRoute() {
  const { organizationId } = useOrg();
  const [overview, setOverview] = useState<CeoOverview | null>(null);
  const [departmentResults, setDepartmentResults] = useState<DepartmentResult[]>([]);
  const [dashboardCount, setDashboardCount] = useState(0);
  const [dashboardLimit, setDashboardLimit] = useState(5);

  useEffect(() => {
    if (!organizationId) return;
    void api.overview(organizationId).then((data) => {
      if (data) setOverview(data);
    });
    void api.results(organizationId).then((data) => {
      if (data) {
        setDepartmentResults(data.results ?? []);
        setDashboardCount(data.dashboardCount ?? 0);
        setDashboardLimit(data.dashboardLimit ?? 5);
      }
    });
  }, [organizationId]);

  const overviewResults = overview?.company?.results ?? overview?.results ?? [];
  const canonicalResults = overview?.company ? overviewResults : departmentResults;
  const resultDetails = new Map(departmentResults.map((result) => [result.id, result]));
  const totalResults = canonicalResults.length;

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

      {totalResults === 0 ? (
        <Card>
          <EmptyState
            title="Todavía no hay entregables"
            description="En cuanto Marketing termine un trabajo, su resultado aparecerá aquí listo para usar."
          />
        </Card>
      ) : (
        <div className="dfy-grid dfy-grid--single">
          {overviewResults.map((result) => (
            <Card key={result.id} title={result.title}>
              <HeadBadge head={result.head} compact />
              <p className="dfy-result">{readable(result.summary)}</p>
              {resultDetails.get(result.id)?.content && (
                <div
                  className="dfy-result__body"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(resultDetails.get(result.id)?.content ?? ""),
                  }}
                />
              )}
              {resultDetails.get(result.id)?.chart && (
                <ChartRenderer chart={resultDetails.get(result.id)!.chart!} />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ChartRenderer(props: { chart: ChartData }) {
  const { chart } = props;
  if (chart.kind === "table" && chart.rows && chart.rows.length > 0) {
    return (
      <table className="dfy-result__table">
        <thead>
          <tr>
            <th>Etiqueta</th>
            <th>Valor</th>
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, index) => (
            <tr key={`${row.label}_${index}`}>
              <td>{row.label}</td>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (chart.kind === "bar" || chart.kind === "line") {
    const series = chart.series[0];
    if (!series) return null;
    const labels = series.labels ?? series.values.map((_, i) => `${i + 1}`);
    const max = Math.max(1, ...series.values);
    return (
      <div className="dfy-chart" data-kind={chart.kind}>
        <div className="dfy-chart__title">{chart.title}</div>
        <div className="dfy-chart__rows">
          {labels.map((label, index) => {
            const value = series.values[index] ?? 0;
            const pct = Math.round((value * 100) / max);
            return (
              <div className="dfy-chart__row" key={`${label}_${index}`}>
                <span className="dfy-chart__label">{label}</span>
                <span className="dfy-chart__bar">
                  <span className="dfy-chart__bar-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="dfy-chart__value">
                  {value}
                  {chart.unit ? ` ${chart.unit}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (chart.kind === "donut") {
    return (
      <div className="dfy-chart" data-kind="donut">
        <div className="dfy-chart__title">{chart.title}</div>
        <ul className="dfy-chart__donut-list">
          {chart.series[0]?.labels?.map((label, index) => (
            <li key={`${label}_${index}`}>
              <strong>{label}</strong>: {chart.series[0]?.values[index] ?? 0}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (chart.kind === "number") {
    return (
      <div className="dfy-chart" data-kind="number">
        <div className="dfy-chart__title">{chart.title}</div>
        <div className="dfy-chart__big">{chart.series[0]?.values[0] ?? 0}</div>
      </div>
    );
  }
  return null;
}

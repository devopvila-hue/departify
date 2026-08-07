import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type CeoOverview } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState, HeadBadge } from "@/components/primitives";

/**
 * Dirección — the CEO's home.
 *
 * Priority: what do you want to achieve → what is your company doing →
 * what needs your decision → what results do you have. No technical
 * metrics, no dashboard for the sake of a dashboard.
 */
export function HomeRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<CeoOverview | null>(null);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.overview(organizationId);
    if (data) setOverview(data);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendGoal() {
    const value = goal.trim();
    if (!organizationId || !value || busy) return;
    setBusy(true);
    setError(null);
    const result = await api.plan(organizationId, value);
    setBusy(false);
    if (!result || result.error) {
      // The CEO never reads provider/runtime errors: only what it means for
      // his company and what he can do about it.
      setError(
        "Tu equipo no ha podido organizar este objetivo ahora mismo. " +
          "Vuelve a intentarlo en un momento.",
      );
      return;
    }
    setGoal("");
    await load();
    navigate("/marketing");
  }

  const pending = overview?.decisions.filter((d) => d.status === "pending") ?? [];

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Dirección</p>
        <h1>¿Qué quieres conseguir?</h1>
        <p className="dfy-hero__lead">
          Dilo con tus palabras. Tus jefes de departamento se encargan del resto.
        </p>
        <div className="dfy-hero__input">
          <input
            type="text"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void sendGoal();
            }}
            placeholder="Quiero conseguir 50 demos en Cataluña durante septiembre."
            aria-label="Objetivo para tu empresa"
            disabled={busy}
          />
          <button
            type="button"
            className="dfy-button"
            onClick={() => void sendGoal()}
            disabled={busy || goal.trim().length === 0}
          >
            {busy ? "Trabajando…" : "Ponerlo en marcha"}
          </button>
        </div>
        {overview?.goal && (
          <p className="dfy-hero__goal">
            Objetivo actual: <strong>{overview.goal}</strong>
          </p>
        )}
        {error && (
          <p className="dfy-alert" role="alert">
            {error}
          </p>
        )}
        <p className="dfy-hero__note">
          Ahora mismo Marketing es el departamento operativo. Cuando se active
          otro, el objetivo llegará también a su jefe.
        </p>
      </section>

      <div className="dfy-grid">
        <Card title="Tu equipo de dirección">
          {(overview?.heads ?? []).map((head) => (
            <button
              key={head.departmentId}
              type="button"
              className="dfy-headrow"
              onClick={() => navigate("/marketing")}
            >
              <HeadBadge head={head} />
              <Badge tone="success">Operativo</Badge>
            </button>
          ))}
          <p className="dfy-muted dfy-muted--small">
            Los demás departamentos todavía no están activos.
          </p>
        </Card>

        {overview?.team && overview.team.specialists.length > 0 && (
          <Card title="Equipo de Elvira">
            <div className="dfy-team-grid">
              <div className="dfy-team-director">
                <HeadBadge
                  head={{
                    departmentId: "marketing",
                    department: "Marketing",
                    name: overview.team.director.name,
                    initials: overview.team.director.initials,
                    role: overview.team.director.role,
                  }}
                />
              </div>
              {overview.team.specialists.map((spec) => (
                <div key={spec.id} className="dfy-team-member">
                  <div className="dfy-team-member__name">{spec.name}</div>
                  <div className="dfy-team-member__role">{spec.role}</div>
                  <Badge
                    tone={
                      spec.status === "preparando" || spec.status === "trabajando"
                        ? "accent"
                        : spec.status === "completado"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {spec.status === "preparando"
                      ? "Preparando"
                      : spec.status === "trabajando"
                        ? "Trabajando"
                        : spec.status === "esperando"
                          ? "Esperando conexión"
                          : spec.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="Necesita tu decisión">
          {pending.length === 0 ? (
            <EmptyState
              title="Nada pendiente"
              description="Cuando un jefe de departamento necesite tu aprobación aparecerá aquí."
            />
          ) : (
            <ul className="dfy-list">
              {pending.map((decision) => (
                <li key={decision.id}>
                  <HeadBadge head={decision.head} compact />
                  <p>{decision.proposal}</p>
                  <button
                    type="button"
                    className="dfy-button dfy-button--ghost"
                    onClick={() => navigate("/decisiones")}
                  >
                    Ver propuesta
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Qué está haciendo tu empresa">
        {(overview?.activity.length ?? 0) === 0 ? (
          <EmptyState
            title="Todavía no hay actividad"
            description="Dile arriba qué quieres conseguir y tu empresa se pondrá a trabajar."
          />
        ) : (
          <ul className="dfy-activity">
            {overview?.activity.map((entry) => (
              <li key={entry.id} className={`dfy-activity__item dfy-activity__item--${entry.tone}`}>
                <span className="dfy-activity__dot" aria-hidden="true" />
                <span>{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Resultados"
        action={
          <button
            type="button"
            className="dfy-button dfy-button--ghost"
            onClick={() => navigate("/resultados")}
          >
            Ver todo
          </button>
        }
      >
        {(overview?.results.length ?? 0) === 0 ? (
          <EmptyState
            title="Aún sin entregables"
            description="Aquí verás lo que tu empresa ha conseguido: análisis, campañas preparadas, contenidos."
          />
        ) : (
          <ul className="dfy-list">
            {overview?.results.slice(0, 3).map((result) => (
              <li key={result.id}>
                <strong>{result.title}</strong>
                <p className="dfy-muted">{truncate(result.summary, 180)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}

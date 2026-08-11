import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type CompanyOperatingState } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState } from "@/components/primitives";
import { readable } from "@/app/readable";

/**
 * TU EMPRESA — Departify Control Plane (Sprint ENGINE 04).
 *
 * The CEO understands the whole company in <10s:
 *  - who runs each department
 *  - what they are doing
 *  - how many digital employees they have
 *  - which tools they use
 *  - which objectives are active
 *  - what needs approval
 *  - what results have been produced
 *  - whether anything is blocked
 *
 * Business language only. No agents, no OpenClaw, no technical sessions.
 */

export function ControlPlaneRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [company, setCompany] = useState<CompanyOperatingState | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<CompanyApproval[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const overview = await api.overview(organizationId);
    if (overview?.company) {
      setCompany(overview.company);
      setPendingApprovals(overview.company.pendingApprovals);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decideApproval(approvalId: string, action: "approve" | "reject") {
    if (!organizationId) return;
    setBusy(true);
    setError(null);
    const result = await api.decideMarketingApproval(organizationId, approvalId, action);
    setBusy(false);
    if (!result || !result.approval) {
      setError("No he podido registrar tu decisión. Inténtalo de nuevo.");
      return;
    }
    await load();
  }

  const departmentStatusLabel = (status: string): string => {
    switch (status) {
      case "trabajando":
        return "Trabajando";
      case "esperando_aprobacion":
        return "Esperando tu aprobación";
      case "bloqueado":
        return "Bloqueado";
      case "necesita_atencion":
        return "Necesita atención";
      case "no_disponible":
        return "No disponible";
      default:
        return "Disponible";
    }
  };

  const statusTone = (status: string): "neutral" | "accent" | "warning" | "danger" | "success" => {
    switch (status) {
      case "trabajando":
        return "accent";
      case "esperando_aprobacion":
      case "bloqueado":
        return "warning";
      case "necesita_atencion":
        return "danger";
      case "no_disponible":
        return "neutral";
      default:
        return "success";
    }
  };

  const employeeStatusLabel = (status: string): string => {
    switch (status) {
      case "trabajando":
        return "Trabajando";
      case "bloqueado":
        return "Bloqueado";
      case "no_disponible":
        return "No disponible";
      default:
        return "Disponible";
    }
  };

  const toolStatusLabel = (status: string): string =>
    status === "connected" ? "Conectado" : "No conectado";

  if (loadFailed) {
    return (
      <div className="dfy-page">
        <section className="dfy-hero">
          <p className="dfy-eyebrow">Tu empresa</p>
          <h1>Tu empresa</h1>
          <p className="dfy-alert" role="alert">
            No he podido cargar el estado de tu empresa ahora mismo. Inténtalo
            de nuevo en un momento.
          </p>
        </section>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="dfy-page">
        <section className="dfy-hero">
          <p className="dfy-eyebrow">Tu empresa</p>
          <h1>Cargando tu empresa…</h1>
        </section>
      </div>
    );
  }

  const department = company.departments[0];
  if (!department) {
    return (
      <div className="dfy-page">
        <section className="dfy-hero">
          <p className="dfy-eyebrow">Tu empresa</p>
          <h1>Sin departamentos operativos</h1>
          <p className="dfy-hero__lead">Todavía no hay un equipo activado para esta empresa.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="dfy-page dfy-control-plane">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Tu empresa</p>
        <h1>Así está trabajando tu empresa</h1>
        <p className="dfy-hero__lead">
          Cada departamento trabaja para conseguir tus objetivos. Tú tomas las
          decisiones; el equipo se encarga del resto.
        </p>
      </section>

      {/* Company status summary — real backend data */}
      <section className="dfy-company-summary" aria-label="Resumen de la empresa">
        <div className="dfy-company-summary__stat">
          <strong>{company.summary.digitalEmployees}</strong>
          <span>empleados digitales</span>
        </div>
        <div className="dfy-company-summary__stat">
          <strong>{company.summary.workingNow}</strong>
          <span>trabajando ahora</span>
        </div>
        <div className="dfy-company-summary__stat">
          <strong>{company.summary.connectedTools}</strong>
          <span>herramientas conectadas</span>
        </div>
        <div className="dfy-company-summary__stat">
          <strong>{company.summary.pendingApprovals}</strong>
          <span>aprobaciones pendientes</span>
        </div>
        <div className="dfy-company-summary__stat">
          <strong>{company.summary.activeObjective ? 1 : 0}</strong>
          <span>objetivo activo</span>
        </div>
      </section>

      {/* Org chart: CEO → department head */}
      <section className="dfy-org" aria-label="Organigrama">
        <div className="dfy-org__ceo">
          <div className="dfy-org__ceo-avatar" aria-hidden="true">D</div>
          <div>
            <strong>CEO</strong>
            <span className="dfy-muted dfy-muted--small">Tú</span>
          </div>
        </div>

        <div className="dfy-org__connector" aria-hidden="true" />

        <div className="dfy-org__department">
          <article className="dfy-card dfy-department-card">
            <header className="dfy-department-card__head">
              <div className="dfy-head">
                <span className="dfy-head__avatar" aria-hidden="true">
                  {department.head.initials}
                </span>
                <span className="dfy-head__text">
                  <strong>{department.head.name}</strong>
                  <span className="dfy-head__role">{department.head.role}</span>
                </span>
              </div>
              <Badge tone={statusTone(department.status)}>
                <span className="dfy-status-dot" aria-hidden="true" />
                {departmentStatusLabel(department.status)}
              </Badge>
            </header>

            {department.activeObjective && (
              <p className="dfy-department-card__objective">
                Objetivo: <strong>{department.activeObjective.title}</strong>
                <span className="dfy-muted dfy-muted--small">
                  {" "}· {department.activeObjective.progress}%
                </span>
              </p>
            )}

            <ul className="dfy-department__metrics">
              <li>
                <strong>{department.employees.length}</strong>
                <span>empleados digitales</span>
              </li>
              <li>
                <strong>{department.employeesWorkingNow}</strong>
                <span>trabajando ahora</span>
              </li>
              <li>
                <strong>{department.toolsConnected}</strong>
                <span>herramientas conectadas</span>
              </li>
            </ul>

            <div className="dfy-department-card__actions">
              <button
                type="button"
                className="dfy-button"
                onClick={() => navigate("/marketing")}
              >
                Ver Marketing
              </button>
              <button
                type="button"
                className="dfy-button dfy-button--ghost"
                onClick={() => navigate("/chat")}
              >
                Hablar con Elvira
              </button>
            </div>
          </article>
        </div>
      </section>

      {error && (
        <p className="dfy-alert" role="alert">
          {error}
        </p>
      )}

      <div className="dfy-grid">
        {/* Digital employees */}
        <Card title="Empleados digitales">
          {(company.employees.length ?? 0) === 0 ? (
            <EmptyState title="Sin empleados" description="El equipo se está formando." />
          ) : (
            <ul className="dfy-list">
              {company.employees.map((employee) => (
                <li
                  key={employee.id}
                  className="dfy-digital-employee"
                  onClick={() =>
                    setSelectedEmployee(selectedEmployee === employee.id ? null : employee.id)
                  }
                >
                  <div className="dfy-digital-employee__main">
                    <strong>{employee.name}</strong>
                    <span className="dfy-muted dfy-muted--small">{employee.role}</span>
                  </div>
                  <Badge tone={employee.status === "trabajando" ? "accent" : "neutral"}>
                    {employeeStatusLabel(employee.status)}
                  </Badge>
                  {selectedEmployee === employee.id && employee.currentWork && (
                    <p className="dfy-muted dfy-muted--small dfy-digital-employee__work">
                      {employee.currentWork}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="dfy-muted dfy-muted--small">
            Cada empleado digital tiene una especialidad. Pulsa una tarjeta para
            ver qué está haciendo.
          </p>
        </Card>

        {/* Connected tools */}
        <Card title="Herramientas">
          {(company.tools.length ?? 0) === 0 ? (
            <EmptyState title="Sin herramientas" description="Conecta una herramienta para que el equipo haga más." />
          ) : (
            <ul className="dfy-list">
              {company.tools.map((tool) => (
                <li key={tool.toolId}>
                  <span className="dfy-tool__label">
                    <strong>{tool.label}</strong>
                    <span className="dfy-muted dfy-muted--small"> · {tool.capability}</span>
                  </span>
                  <Badge tone="success">
                    {toolStatusLabel(tool.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Approvals */}
        <Card title="Aprobaciones">
          {(pendingApprovals.length ?? 0) === 0 ? (
            <EmptyState
              title="Nada pendiente"
              description="Cuando Elvira necesite tu decisión aparecerá aquí."
            />
          ) : (
            <ul className="dfy-list">
              {pendingApprovals.map((approval) => (
                <li key={approval.id}>
                  <p className="dfy-approval__title">
                    <strong>{approval.title}</strong>
                    {approval.cost && <Badge tone="warning">{approval.cost}</Badge>}
                  </p>
                  <p className="dfy-muted dfy-muted--small">{approval.detail}</p>
                  <div className="dfy-approval__actions">
                    <button
                      type="button"
                      className="dfy-button dfy-button--small"
                      disabled={busy}
                      onClick={() => void decideApproval(approval.id, "approve")}
                    >
                      Aprobar
                    </button>
                    <button
                      type="button"
                      className="dfy-button dfy-button--ghost dfy-button--small"
                      disabled={busy}
                      onClick={() => void decideApproval(approval.id, "reject")}
                    >
                      Rechazar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Activity */}
        <Card title="Actividad">
          {(company.activity.length ?? 0) === 0 ? (
            <EmptyState title="Todavía no hay actividad" description="En cuanto Elvira empiece a mover algo, lo verás aquí." />
          ) : (
            <ul className="dfy-activity">
              {company.activity.map((entry) => (
                <li key={entry.id} className="dfy-activity__item dfy-activity__item--working">
                  <span className="dfy-activity__dot" aria-hidden="true" />
                  <span>{readable(entry.message)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Results */}
      <Card title="Resultados">
        {(company.results.length ?? 0) === 0 ? (
          <EmptyState
            title="Aún sin entregables"
            description="Cuando el equipo termine algo, aparecerá aquí."
          />
        ) : (
          <ul className="dfy-list">
          {company.results.map((result) => (
              <li key={result.id}>
                <strong>{result.title}</strong>
                <p className="dfy-muted">{readable(result.summary)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface CompanyApproval {
  id: string;
  from: string;
  title: string;
  detail: string;
  cost?: string;
  status: string;
  createdAt: string;
}

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type CompanyStatus, type HeadIdentity } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { ChatIcon, DepartmentsIcon } from "@/components/icons";

/**
 * Departamentos — Sprint 59.
 *
 * The CEO sees active departments. Each card shows who runs it, who's
 * working, what tools are connected, and a "Hablar sobre Marketing"
 * button that opens the CENTRAL chat with that department as context.
 *
 * There is NO primary chat inside any department. The chat is global.
 */
export function DepartmentsRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [head, setHead] = useState<HeadIdentity | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const [statusData, handoff] = await Promise.all([
      api.status(organizationId),
      api.handoff(organizationId),
    ]);
    if (statusData) setStatus(statusData);
    if (handoff) setHead(handoff.head);
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active: Array<{
    id: string;
    name: string;
    head: HeadIdentity | null;
    teamSize: number;
    activeTasks: number;
    tools: number;
  }> = [
    {
      id: "marketing",
      name: "Marketing",
      head,
      teamSize: 3,
      activeTasks:
        (status?.marketingWork?.items ?? []).filter(
          (it) =>
            it.status === "running" ||
            it.status === "pending" ||
            it.status === "approved" ||
            it.status === "needs_approval",
        ).length,
      tools: (status?.connections ?? []).filter((c) => c.status === "connected").length,
    },
  ];

  const future = [
    { id: "sales", name: "Ventas", status: "Pronto" },
    { id: "finance", name: "Finanzas", status: "Pronto" },
    { id: "operations", name: "Operaciones", status: "Pronto" },
  ];

  function openInChat(deptId: string, deptName: string) {
    const focus = encodeURIComponent(`Háblame de ${deptName}.`);
    navigate(`/chat?focus=${focus}`);
  }

  return (
    <div className="dfy-page">
      <section className="dfy-hero">
        <p className="dfy-eyebrow">Departamentos</p>
        <h1>Los equipos que trabajan para tu empresa</h1>
        <p className="dfy-hero__lead">
          Hoy Marketing está operativo. Los demás llegarán. Para hablar
          con cualquier departamento, usa el chat.
        </p>
      </section>

      <h2 className="dfy-section-title">Activos</h2>
      <div className="dfy-grid">
        {active.map((dept) => (
          <article key={dept.id} className="dfy-card dfy-department">
            <header>
              <DepartmentsIcon className="dfy-card__icon" />
              <strong>{dept.name}</strong>
              <span className="dfy-event__pill dfy-event__pill--success">Activo</span>
            </header>
            {dept.head && (
              <p className="dfy-department__head">
                {dept.head.name} · {dept.head.role}
              </p>
            )}
            <ul className="dfy-department__metrics">
              <li>
                <strong>{dept.teamSize}</strong>
                <span>especialistas</span>
              </li>
              <li>
                <strong>{dept.activeTasks}</strong>
                <span>tareas activas</span>
              </li>
              <li>
                <strong>{dept.tools}</strong>
                <span>herramientas conectadas</span>
              </li>
            </ul>
            <div className="dfy-department__actions">
              <button
                type="button"
                className="dfy-button"
                onClick={() => navigate("/tareas")}
              >
                Ver tareas
              </button>
              <button
                type="button"
                className="dfy-button dfy-button--ghost"
                onClick={() => openInChat(dept.id, dept.name)}
              >
                <ChatIcon /> Hablar sobre {dept.name}
              </button>
            </div>
          </article>
        ))}
      </div>

      <h2 className="dfy-section-title">Próximamente</h2>
      <div className="dfy-grid">
        {future.map((dept) => (
          <article key={dept.id} className="dfy-card dfy-department dfy-department--future">
            <header>
              <DepartmentsIcon className="dfy-card__icon" />
              <strong>{dept.name}</strong>
              <span className="dfy-event__pill">{dept.status}</span>
            </header>
            <p className="dfy-muted">
              Todavía no está activo. Te avisaremos en cuanto esté listo.
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

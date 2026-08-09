import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, type MarketingDepartmentStatus } from "@/app/api";
import { useOrg } from "@/app/org-context";
import { Badge, Card, EmptyState, HeadBadge } from "@/components/primitives";
import { readable } from "@/app/readable";

/**
 * Marketing — department detail (Sprint ENGINE 04).
 *
 * A full business workspace for the Marketing department:
 *  - header with Elvira (Directora de Marketing) + status
 *  - current objective + progress
 *  - digital employees
 *  - connected tools (honest)
 *  - pending approvals (decide here)
 *  - activity
 *  - results
 *  - integrated chat with Elvira (Portal → Backend → EngineAdapter → OpenClaw → Vertex)
 *
 * Business language only. No agents, no OpenClaw, no technical sessions.
 */

export function MarketingRoute() {
  const { organizationId } = useOrg();
  const navigate = useNavigate();
  const [department, setDepartment] = useState<MarketingDepartmentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [showObjectiveForm, setShowObjectiveForm] = useState(false);
  const [objectiveForm, setObjectiveForm] = useState({
    title: "",
    description: "",
    desiredOutcome: "",
    constraints: "",
  });

  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    const data = await api.marketingDepartment(organizationId);
    if (data) {
      setDepartment(data);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusLabel = useMemo(() => {
    if (!department) return "Disponible";
    switch (department.status) {
      case "trabajando":
        return "Trabajando";
      case "esperando_aprobacion":
        return "Esperando tu aprobación";
      case "bloqueado":
        return "Bloqueado";
      case "necesita_atencion":
        return "Necesita atención";
      default:
        return "Disponible";
    }
  }, [department]);

  const statusTone = useMemo(() => {
    if (!department) return "neutral" as const;
    switch (department.status) {
      case "trabajando":
        return "accent" as const;
      case "esperando_aprobacion":
      case "bloqueado":
        return "warning" as const;
      case "necesita_atencion":
        return "danger" as const;
      default:
        return "success" as const;
    }
  }, [department]);

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

  async function createObjective() {
    if (!organizationId) return;
    const title = objectiveForm.title.trim();
    const description = objectiveForm.description.trim();
    const desiredOutcome = objectiveForm.desiredOutcome.trim();
    if (!title || !description || !desiredOutcome) {
      setError("El objetivo necesita título, descripción y resultado deseado.");
      return;
    }
    setBusy(true);
    setError(null);
    const constraints = objectiveForm.constraints
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const result = await api.createMarketingObjective(organizationId, {
      title,
      description,
      desiredOutcome,
      ...(constraints.length > 0 ? { constraints } : {}),
    });
    setBusy(false);
    if (!result || !result.objective) {
      setError("No he podido crear el objetivo. Inténtalo de nuevo.");
      return;
    }
    setShowObjectiveForm(false);
    setObjectiveForm({ title: "", description: "", desiredOutcome: "", constraints: "" });
    await load();
  }

  async function sendToElvira() {
    const value = message.trim();
    if (!organizationId || !value || chatBusy) return;
    setChatBusy(true);
    setError(null);
    setMessage("");
    setChat((prev) => [...prev, { role: "user", content: value }]);
    const result = await api.marketingMessage(organizationId, value);
    setChatBusy(false);
    if (!result) {
      setError("Elvira no ha podido responderte ahora mismo. Inténtalo de nuevo.");
      return;
    }
    setChat((prev) => [...prev, { role: "assistant", content: result.reply }]);
    await load();
  }

  if (loadFailed) {
    return (
      <div className="dfy-page">
        <section className="dfy-hero">
          <p className="dfy-eyebrow">Departamento</p>
          <h1>Marketing</h1>
          <p className="dfy-alert" role="alert">
            No he podido cargar el estado de Marketing ahora mismo. Inténtalo
            de nuevo en un momento.
          </p>
        </section>
      </div>
    );
  }

  if (!department) {
    return (
      <div className="dfy-page">
        <section className="dfy-hero">
          <p className="dfy-eyebrow">Departamento</p>
          <h1>Cargando Marketing…</h1>
        </section>
      </div>
    );
  }

  return (
    <div className="dfy-page">
      <section className="dfy-hero dfy-hero--department">
        <p className="dfy-eyebrow">Departamento</p>
        <h1>Marketing</h1>
        <div className="dfy-marketing-head">
          <HeadBadge head={department.head} />
          <Badge tone={statusTone}>
            <span className="dfy-status-dot" aria-hidden="true" />
            {statusLabel}
          </Badge>
        </div>
        {department.activeObjective && (
          <p className="dfy-hero__goal">
            Objetivo: <strong>{department.activeObjective.title}</strong> ·{" "}
            {department.activeObjective.progress}%
          </p>
        )}
        <div className="dfy-marketing-head__actions">
          <button
            type="button"
            className="dfy-button dfy-button--ghost"
            onClick={() => setShowObjectiveForm((v) => !v)}
          >
            {showObjectiveForm ? "Cerrar" : "Nuevo objetivo"}
          </button>
          <button
            type="button"
            className="dfy-button dfy-button--ghost"
            onClick={() => navigate("/inicio")}
          >
            Volver a tu empresa
          </button>
        </div>
      </section>

      {error && (
        <p className="dfy-alert" role="alert">
          {error}
        </p>
      )}

      {showObjectiveForm && (
        <Card title="Nuevo objetivo">
          <div className="dfy-objective-form">
            <input
              type="text"
              placeholder="Título, ej. Conseguir 20 leads cualificados"
              aria-label="Título del objetivo"
              value={objectiveForm.title}
              onChange={(e) =>
                setObjectiveForm((f) => ({ ...f, title: e.target.value }))
              }
            />
            <input
              type="text"
              placeholder="Resultado deseado, ej. 20 leads cualificados"
              aria-label="Resultado deseado"
              value={objectiveForm.desiredOutcome}
              onChange={(e) =>
                setObjectiveForm((f) => ({ ...f, desiredOutcome: e.target.value }))
              }
            />
            <textarea
              placeholder="Descripción del objetivo"
              aria-label="Descripción del objetivo"
              value={objectiveForm.description}
              onChange={(e) =>
                setObjectiveForm((f) => ({ ...f, description: e.target.value }))
              }
              rows={3}
            />
            <input
              type="text"
              placeholder="Restricciones separadas por coma, ej. Presupuesto: 500 €, Tenemos una landing"
              aria-label="Restricciones"
              value={objectiveForm.constraints}
              onChange={(e) =>
                setObjectiveForm((f) => ({ ...f, constraints: e.target.value }))
              }
            />
            <button
              type="button"
              className="dfy-button"
              disabled={busy}
              onClick={() => void createObjective()}
            >
              {busy ? "Creando…" : "Crear objetivo"}
            </button>
          </div>
        </Card>
      )}

      {/* Objective + progress */}
      <Card title="Objetivo actual">
        {department.activeObjective ? (
          <>
            <p className="dfy-muted dfy-muted--small">
              Deseo: {department.activeObjective.desiredOutcome}
            </p>
            <p>{department.activeObjective.description}</p>
            {department.activeObjective.constraints.length > 0 && (
              <p className="dfy-muted dfy-muted--small">
                Restricciones: {department.activeObjective.constraints.join(" · ")}
              </p>
            )}
            <div className="dfy-progress" role="progressbar" aria-valuenow={department.activeObjective.progress} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${department.activeObjective.progress}%` }} />
            </div>
            <p className="dfy-muted dfy-muted--small">
              Progreso: {department.activeObjective.progress}%
            </p>
          </>
        ) : (
          <EmptyState
            title="Sin objetivo activo"
            description="Crea un objetivo o cuéntaselo a Elvira en el chat y preparará el plan."
          />
        )}
      </Card>

      <div className="dfy-grid">
        {/* Digital employees */}
        <Card title="Empleados digitales">
          <ul className="dfy-list">
            {department.employees.map((employee) => (
              <li key={employee.id} className="dfy-digital-employee">
                <div className="dfy-digital-employee__main">
                  <strong>{employee.label}</strong>
                  <span className="dfy-muted dfy-muted--small">{employee.role}</span>
                  {employee.currentWork && (
                    <span className="dfy-muted dfy-muted--small">
                      Actualmente: {employee.currentWork}
                    </span>
                  )}
                </div>
                <Badge tone={employee.status === "trabajando" ? "accent" : "neutral"}>
                  {employee.status === "trabajando"
                    ? "Trabajando"
                    : employee.status === "bloqueado"
                      ? "Bloqueado"
                      : "Disponible"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        {/* Connected tools */}
        <Card title="Herramientas">
          <ul className="dfy-list">
            {department.tools.map((tool) => (
              <li key={tool.toolId}>
                <span className="dfy-tool__label">
                  <strong>{tool.label}</strong>
                  <span className="dfy-muted dfy-muted--small"> · {tool.capability}</span>
                </span>
                <Badge tone={tool.status === "connected" ? "success" : "neutral"}>
                  {tool.status === "connected" ? "Conectado" : "No conectado"}
                </Badge>
              </li>
            ))}
          </ul>
          <p className="dfy-muted dfy-muted--small">
            Nunca fingimos una conexión. Sin conectar, el equipo planifica y
            analiza; conectar una herramienta le permite ejecutar.
          </p>
        </Card>

        {/* Approvals */}
        <Card title="Aprobaciones">
          {department.pendingApprovals.length === 0 ? (
            <EmptyState
              title="Nada pendiente"
              description="Cuando Elvira necesite tu decisión aparecerá aquí."
            />
          ) : (
            <ul className="dfy-list">
              {department.pendingApprovals.map((approval) => (
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
          {department.recentActivity.length === 0 ? (
            <EmptyState title="Todavía no hay actividad" description="Cuando el equipo trabaje, lo verás aquí." />
          ) : (
            <ul className="dfy-activity">
              {department.recentActivity.map((entry) => (
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
        {department.results.length === 0 ? (
          <EmptyState title="Aún sin entregables" description="Cuando el equipo termine algo, aparecerá aquí." />
        ) : (
          <ul className="dfy-list">
            {department.results.map((result) => (
              <li key={result.id}>
                <strong>{result.title}</strong>
                <p className="dfy-muted">{readable(result.summary)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Chat with Elvira */}
      <Card title="Hablar con Elvira">
        <p className="dfy-muted dfy-muted--small">
          Cuéntale lo que necesitas. La conversación llega a Elvira a través de
          Departify y se queda en la empresa.
        </p>
        <div className="dfy-chat">
          {chat.length === 0 && (
            <p className="dfy-muted">
              Sin mensajes todavía. Pregúntale por el objetivo, los canales o el
              plan de Marketing.
            </p>
          )}
          {chat.map((turn, index) => (
            <div
              key={`mkt_${index}`}
              className={`dfy-bubble${turn.role === "user" ? " dfy-bubble--user" : ""}`}
            >
              <span className="dfy-bubble__who">{turn.role === "user" ? "Tú" : "Elvira"}</span>
              <p>{readable(turn.content)}</p>
            </div>
          ))}
        </div>
        <div className="dfy-composer">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendToElvira();
            }}
            placeholder="Quiero 20 leads este mes con 500 € y una landing."
            aria-label="Mensaje para Elvira"
            disabled={chatBusy}
          />
          <button
            type="button"
            className="dfy-button"
            onClick={() => void sendToElvira()}
            disabled={chatBusy || message.trim().length === 0}
          >
            {chatBusy ? "Elvira piensa…" : "Enviar"}
          </button>
        </div>
      </Card>
    </div>
  );
}

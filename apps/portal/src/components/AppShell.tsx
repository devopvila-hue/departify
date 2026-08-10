import { useEffect, useState, type ReactElement } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/app/auth-context";
import { useOrg } from "@/app/org-context";
import {
  ApprovalsIcon,
  ChatIcon,
  CompanyIcon,
  ConnectionsIcon,
  DepartmentsIcon,
  MenuIcon,
  ResultsIcon,
  SettingsIcon,
  TasksIcon,
  type IconProps,
} from "@/components/icons";

/**
 * Sprint 59 — the conversational application shell.
 *
 * ChatGPT / OpenClaw information architecture: the sidebar is a flat
 * list of primary destinations. Chat is the home. There is no
 * "Command Center" inside a dashboard — the conversation IS the
 * application.
 *
 * The sidebar collapses to a drawer on mobile. The icon style is
 * restrained, premium line icons sized to the 16px grid; no emoji,
 * no decorative fills.
 */

type IconEntry = { to: string; label: string; icon: (props: IconProps) => ReactElement };
type IconEntryWithBadge = IconEntry & { badgeKey?: "approvals" };

const PRIMARY: IconEntry[] = [
  { to: "/inicio", label: "Tu empresa", icon: CompanyIcon },
  { to: "/chat", label: "Chat", icon: ChatIcon },
  { to: "/tareas", label: "Tareas", icon: TasksIcon },
  { to: "/inbox", label: "Inbox", icon: CompanyIcon },
];

const SECONDARY: IconEntry[] = [
  { to: "/departamentos", label: "Departamentos", icon: DepartmentsIcon },
  { to: "/conexiones", label: "Conexiones", icon: ConnectionsIcon },
];

const TERTIARY: IconEntryWithBadge[] = [
  { to: "/aprobaciones", label: "Aprobaciones", icon: ApprovalsIcon, badgeKey: "approvals" },
  { to: "/resultados", label: "Resultados", icon: ResultsIcon },
];

const FOOT: IconEntry[] = [
  { to: "/empresa", label: "Empresa", icon: CompanyIcon },
  { to: "/configuracion", label: "Configuración", icon: SettingsIcon },
];

export function AppShell(props: { companyName?: string; pendingApprovals?: number }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { setOrganizationId } = useOrg();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  async function handleLogout() {
    await signOut();
    setOrganizationId(null);
    navigate("/");
  }

  const renderItem = (item: IconEntryWithBadge) => {
    const Icon = item.icon;
    const badge =
      item.badgeKey === "approvals" && (props.pendingApprovals ?? 0) > 0
        ? props.pendingApprovals
        : null;
    return (
      <li key={item.to}>
        <NavLink
          to={item.to}
          className={({ isActive }) =>
            `dfy-navitem${isActive ? " dfy-navitem--active" : ""}`
          }
        >
          <span className="dfy-navitem__row">
            <Icon className="dfy-navitem__icon" />
            <span>{item.label}</span>
          </span>
          {badge != null && (
            <span className="dfy-navitem__count" aria-label={`${badge} pendientes`}>
              {badge}
            </span>
          )}
        </NavLink>
      </li>
    );
  };

  return (
    <div className="dfy-shell">
      {open && (
        <div
          className="dfy-shell__scrim"
          role="presentation"
          onClick={() => setOpen(false)}
        />
      )}

      <nav
        className={`dfy-sidebar${open ? " dfy-sidebar--open" : ""}`}
        aria-label="Navegación principal"
      >
        <div className="dfy-sidebar__brand">
          <span className="dfy-sidebar__mark" aria-hidden="true">
            D
          </span>
          <span className="dfy-sidebar__brandlabel">
            <strong>Departify</strong>
            <span className="dfy-sidebar__product">Tu empresa</span>
          </span>
        </div>

        <ul className="dfy-sidebar__nav">{PRIMARY.map(renderItem)}</ul>

        <ul className="dfy-sidebar__nav dfy-sidebar__nav--sub">{SECONDARY.map(renderItem)}</ul>

        <ul className="dfy-sidebar__nav dfy-sidebar__nav--sub">{TERTIARY.map(renderItem)}</ul>

        <ul className="dfy-sidebar__nav dfy-sidebar__nav--foot">{FOOT.map(renderItem)}</ul>

        <p className="dfy-sidebar__foot">
          Marketing es el departamento activo. Los demás se activarán cuando
          estén listos.
        </p>
      </nav>

      <div className="dfy-shell__main">
        <header className="dfy-topbar">
          <button
            type="button"
            className="dfy-topbar__menu"
            aria-label="Abrir navegación"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <MenuIcon />
          </button>
          <span className="dfy-topbar__company">
            {props.companyName || "Tu empresa"}
          </span>
          <button
            type="button"
            className="dfy-topbar__logout"
            onClick={() => void handleLogout()}
          >
            Salir
          </button>
        </header>

        <main className="dfy-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { useEffect, useState, type ReactElement } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "@/app/auth-context";
import { api } from "@/app/api";
import { useOrg } from "@/app/org-context";
import {
  ApprovalsIcon,
  CalendarIcon,
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

type IconEntry = {
  to: string;
  label: string;
  icon: (props: IconProps) => ReactElement;
};
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
  {
    to: "/aprobaciones",
    label: "Aprobaciones",
    icon: ApprovalsIcon,
    badgeKey: "approvals",
  },
  { to: "/resultados", label: "Resultados", icon: ResultsIcon },
  { to: "/calendario", label: "Calendario", icon: CalendarIcon },
];

const FOOT: IconEntry[] = [
  { to: "/empresa", label: "Empresa", icon: CompanyIcon },
  { to: "/configuracion", label: "Configuración", icon: SettingsIcon },
];

function prefetchRoute(path: string, organizationId: string | null): void {
  if (!organizationId) return;
  const requests: Promise<unknown>[] = [];
  switch (path) {
    case "/inicio":
      requests.push(
        api.overview(organizationId),
        api.commandCenterOpening(organizationId),
        api.status(organizationId),
      );
      break;
    case "/chat":
      requests.push(
        api.commandCenterOpening(organizationId),
        api.conversations(organizationId),
      );
      break;
    case "/tareas":
      requests.push(
        api.status(organizationId),
        api.handoff(organizationId),
        api.workFeed(organizationId),
      );
      break;
    case "/inbox":
      requests.push(api.inbox(organizationId));
      break;
    case "/conexiones":
      requests.push(api.connections(organizationId));
      break;
    case "/marketing":
      requests.push(api.marketingDepartment(organizationId));
      break;
    case "/seo":
      requests.push(api.seoDepartment(organizationId));
      break;
    case "/configuracion":
      requests.push(
        api.status(organizationId),
        api.connections(organizationId),
        api.llmSettings(organizationId),
      );
      break;
    case "/aprobaciones":
      requests.push(
        api.overview(organizationId),
        api.marketingApprovals(organizationId),
      );
      break;
    case "/resultados":
      requests.push(
        api.overview(organizationId),
        api.results(organizationId),
        api.dashboardSummary(organizationId),
      );
      break;
    case "/calendario":
      requests.push(api.calendar(organizationId));
      break;
    default:
      break;
  }
  void Promise.all(requests);
}

export function AppShell(props: {
  companyName?: string;
  pendingApprovals?: number;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { organizationId, setOrganizationId } = useOrg();

  useEffect(() => {
    if (!organizationId) return;
    // Keep the initial warm-up deliberately small. The rest is prefetched
    // on intent (hover/focus) so login never downloads the whole product.
    const timer = window.setTimeout(() => {
      void Promise.all([
        api.connections(organizationId),
        api.workFeed(organizationId),
        api.conversations(organizationId),
      ]);
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [organizationId]);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Close the drawer when the user taps outside the sidebar or the hamburger.
  // The scrim itself is `pointer-events: none` so the tap reaches the page
  // content underneath (e.g. the "Ver SEO" button on mobile). We still close
  // the menu on every outside tap via this document listener, preserving the
  // original drawer UX.
  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest(".dfy-sidebar") ||
          target.closest(".dfy-topbar__menu"))
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

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
          onMouseEnter={() => prefetchRoute(item.to, organizationId)}
          onFocus={() => prefetchRoute(item.to, organizationId)}
          className={({ isActive }) =>
            `dfy-navitem${isActive ? " dfy-navitem--active" : ""}`
          }
        >
          <span className="dfy-navitem__row">
            <Icon className="dfy-navitem__icon" />
            <span>{item.label}</span>
          </span>
          {badge != null && (
            <span
              className="dfy-navitem__count"
              aria-label={`${badge} pendientes`}
            >
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
        <div className="dfy-shell__scrim" role="presentation" />
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

        <ul className="dfy-sidebar__nav dfy-sidebar__nav--sub">
          {SECONDARY.map(renderItem)}
        </ul>

        <ul className="dfy-sidebar__nav dfy-sidebar__nav--sub">
          {TERTIARY.map(renderItem)}
        </ul>

        <ul className="dfy-sidebar__nav dfy-sidebar__nav--foot">
          {FOOT.map(renderItem)}
        </ul>

        <p className="dfy-sidebar__foot">
          Marketing y SEO trabajan para tus objetivos.
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

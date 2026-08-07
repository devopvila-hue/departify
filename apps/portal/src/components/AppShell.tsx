import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

/**
 * The Departify shell — sidebar + topbar + content, adapted from the
 * historical portal's shell (240px rail, 64px sticky header, mobile drawer
 * with scrim) and reduced to what this product really has.
 *
 * There is no "Agents" entry: the CEO directs department heads, not agents.
 */

const NAV = [
  { to: "/inicio", label: "Inicio", hint: "Dirección" },
  { to: "/marketing", label: "Marketing", hint: "Departamento" },
  { to: "/decisiones", label: "Decisiones", hint: "Aprobaciones" },
  { to: "/resultados", label: "Resultados", hint: "Entregado" },
  { to: "/conexiones", label: "Conexiones", hint: "Herramientas" },
  { to: "/empresa", label: "Empresa", hint: "Lo que sabemos" },
];

export function AppShell(props: { companyName?: string; pending?: number }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

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
          <span>
            <strong>Departify</strong>
            <span className="dfy-sidebar__product">Tu empresa</span>
          </span>
        </div>

        <ul className="dfy-sidebar__nav">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `dfy-navitem${isActive ? " dfy-navitem--active" : ""}`
                }
              >
                <span>{item.label}</span>
                {item.to === "/decisiones" && (props.pending ?? 0) > 0 && (
                  <span className="dfy-navitem__count">{props.pending}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

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
            ☰
          </button>
          <span className="dfy-topbar__company">
            {props.companyName || "Tu empresa"}
          </span>
        </header>

        <main className="dfy-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { NavLink } from "react-router-dom";

export function DepartmentWorkspaceNav(props: { departmentId: "marketing" | "seo" }) {
  const base = `/${props.departmentId}`;
  const items = [
    { to: base, label: "Trabajo" },
    { to: `${base}/dashboards`, label: "Dashboards" },
    { to: `${base}/calendario`, label: "Calendario" },
    { to: "/resultados", label: "Resultados" },
    { to: "/aprobaciones", label: "Decisiones" },
  ];
  return (
    <nav className="dfy-department-nav" aria-label={`Navegación de ${props.departmentId}`}>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === base}>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

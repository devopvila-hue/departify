/**
 * DepartmentChip — the only place that renders a department badge.
 * Consumes the Department Visual Identity registry so every screen
 * (Kanban, Calendar, Results, Approvals, Home) uses the same accent.
 *
 * Usage:
 *   <DepartmentChip departmentId={task.departmentId} />
 *   <DepartmentChip departmentId="marketing" showLabel />
 */
import {
  DEPARTMENT_VISUAL_IDENTITY,
  type DepartmentVisualIdentity,
  visualIdentityForDepartment,
} from "@/app/department-visual-identity";

export interface DepartmentChipProps {
  readonly departmentId?: string | null;
  readonly showLabel?: boolean;
  readonly title?: string;
  readonly identity?: DepartmentVisualIdentity;
}

export function DepartmentChip(props: DepartmentChipProps) {
  const identity = props.identity ?? visualIdentityForDepartment(props.departmentId);
  const style = cssVarsFor(identity);
  return (
    <span
      className="dfy-dept-chip"
      style={style}
      title={props.title ?? identity.label}
      data-department={identity.id}
    >
      <span className="dfy-dept-chip__dot" aria-hidden="true" />
      {props.showLabel === false ? identity.initial : identity.label}
    </span>
  );
}

export function cssVarsFor(identity: DepartmentVisualIdentity): React.CSSProperties {
  return {
    // CSS custom properties; consumers pick them up via var(--dept-*)
    ["--dept-accent" as never]: `var(${identity.accentVar})`,
    ["--dept-tint" as never]: `var(${identity.tintVar})`,
    ["--dept-tint-strong" as never]: `var(${identity.tintStrongVar})`,
    ["--dept-border" as never]: `var(${identity.borderVar})`,
  };
}

export { DEPARTMENT_VISUAL_IDENTITY };

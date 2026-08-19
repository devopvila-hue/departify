import type { ReactNode } from "react";

/**
 * Portal primitives — adapted from the historical Departify portal's design
 * system (Card / Badge / EmptyState / Chip). Same visual language, new and
 * much smaller surface: only what this product actually renders.
 */

export function Card(props: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section
      className={`dfy-card${props.className ? ` ${props.className}` : ""}`}
      style={props.style}
    >
      {(props.title || props.action) && (
        <header className="dfy-card__head">
          {props.title && <h2>{props.title}</h2>}
          {props.action}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function EmptyState(props: { title: string; description: string }) {
  return (
    <div className="dfy-empty">
      <p className="dfy-empty__title">{props.title}</p>
      <p className="dfy-empty__description">{props.description}</p>
    </div>
  );
}

export type BadgeTone = "neutral" | "accent" | "warning" | "danger" | "success";

export function Badge(props: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`dfy-badge dfy-badge--${props.tone ?? "neutral"}`}>
      {props.children}
    </span>
  );
}

export function Chip(props: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`dfy-chip${props.selected ? " dfy-chip--selected" : ""}`}
      aria-pressed={props.selected ?? false}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export interface HeadIdentity {
  departmentId: string;
  department: string;
  name: string;
  initials: string;
  role: string;
}

/**
 * The person the CEO works with. Never an agent id, never a model name.
 */
export function HeadBadge(props: { head: HeadIdentity; compact?: boolean }) {
  return (
    <div className={`dfy-head${props.compact ? " dfy-head--compact" : ""}`}>
      <span className="dfy-head__avatar" aria-hidden="true">
        {props.head.initials}
      </span>
      <span className="dfy-head__text">
        <strong>{props.head.name}</strong>
        <span className="dfy-head__role">
          {props.head.role} · {props.head.department}
        </span>
      </span>
    </div>
  );
}

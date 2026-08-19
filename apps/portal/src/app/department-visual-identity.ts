/**
 * Department Visual Identity — single source of truth for the
 * department accent, tint and lateral indicator used across the
 * Operating Loop surfaces.
 *
 * The actual CSS variables live in `apps/portal/src/styles/tokens.css`.
 * This module mirrors them as TypeScript so the portal can compose
 * inline styles + class names without re-declaring the palette per
 * component. If a department is added here, add the matching CSS
 * variables in tokens.css and the portal picks it up uniformly.
 */

export type DepartmentVisualId =
  | "marketing"
  | "seo"
  | "direccion"
  | "ventas"
  | "ingenieria";

export interface DepartmentVisualIdentity {
  readonly id: DepartmentVisualId;
  readonly label: string;
  readonly shortLabel: string;
  /** CSS variable name used as the dot/icon stroke (e.g. `--dfy-dept-marketing-accent`). */
  readonly accentVar: string;
  /** Subtle tinted background (≤ 10% alpha) for cards / Kanban columns. */
  readonly tintVar: string;
  /** Stronger tint for column headers and chips. */
  readonly tintStrongVar: string;
  /** 2-3px lateral border tone. */
  readonly borderVar: string;
  /** Initial letter used when no icon is provided (badge / chip). */
  readonly initial: string;
}

export const DEPARTMENT_VISUAL_IDENTITY: Record<DepartmentVisualId, DepartmentVisualIdentity> = {
  marketing: {
    id: "marketing",
    label: "Marketing",
    shortLabel: "Mkt",
    accentVar: "--dfy-dept-marketing-accent",
    tintVar: "--dfy-dept-marketing-tint",
    tintStrongVar: "--dfy-dept-marketing-tint-strong",
    borderVar: "--dfy-dept-marketing-border",
    initial: "M",
  },
  seo: {
    id: "seo",
    label: "SEO",
    shortLabel: "SEO",
    accentVar: "--dfy-dept-seo-accent",
    tintVar: "--dfy-dept-seo-tint",
    tintStrongVar: "--dfy-dept-seo-tint-strong",
    borderVar: "--dfy-dept-seo-border",
    initial: "S",
  },
  direccion: {
    id: "direccion",
    label: "Dirección",
    shortLabel: "Dir",
    accentVar: "--dfy-dept-direccion-accent",
    tintVar: "--dfy-dept-direccion-tint",
    tintStrongVar: "--dfy-dept-direccion-tint-strong",
    borderVar: "--dfy-dept-direccion-border",
    initial: "D",
  },
  ventas: {
    id: "ventas",
    label: "Ventas",
    shortLabel: "Vnt",
    accentVar: "--dfy-dept-ventas-accent",
    tintVar: "--dfy-dept-ventas-tint",
    tintStrongVar: "--dfy-dept-ventas-tint-strong",
    borderVar: "--dfy-dept-ventas-border",
    initial: "V",
  },
  ingenieria: {
    id: "ingenieria",
    label: "Ingeniería",
    shortLabel: "Ing",
    accentVar: "--dfy-dept-ingenieria-accent",
    tintVar: "--dfy-dept-ingenieria-tint",
    tintStrongVar: "--dfy-dept-ingenieria-tint-strong",
    borderVar: "--dfy-dept-ingenieria-border",
    initial: "I",
  },
};

/**
 * Normalize an arbitrary department id (`"marketing"`, `"Marketing"`,
 * `"departify.seo"`, ...) to a registered visual id. Unknown
 * departments fall back to `direccion` (the Departify brand accent)
 * so the UI never breaks.
 */
export function visualIdentityForDepartment(departmentId: string | null | undefined): DepartmentVisualIdentity {
  if (!departmentId) return DEPARTMENT_VISUAL_IDENTITY.direccion;
  const normalized = departmentId.toLowerCase().split(/[.\s_-]+/)[0] ?? "";
  if (
    normalized === "marketing" ||
    normalized === "seo" ||
    normalized === "direccion" ||
    normalized === "ventas" ||
    normalized === "ingenieria"
  ) {
    return DEPARTMENT_VISUAL_IDENTITY[normalized];
  }
  return DEPARTMENT_VISUAL_IDENTITY.direccion;
}

/**
 * Inline-style helpers that read from the CSS custom properties
 * declared in tokens.css. Use these for cards / chips / Kanban
 * columns so the visual identity remains consistent across screens.
 */
export function deptStyle(
  identity: DepartmentVisualIdentity,
): { borderLeftColor: string; backgroundColor: string; color: string } {
  if (typeof window === "undefined") {
    return { borderLeftColor: "", backgroundColor: "", color: "" };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    borderLeftColor: styles.getPropertyValue(identity.borderVar).trim(),
    backgroundColor: styles.getPropertyValue(identity.tintVar).trim(),
    color: styles.getPropertyValue(identity.accentVar).trim(),
  };
}

/**
 * Department identities — the humans the CEO works with.
 *
 * IMPORTANT (Fase 5): before defining this, `departify.app`, the historical
 * `opencloud-client` portal and this repository were all searched for existing
 * department-head identities. None exist: the public site presents departments
 * abstractly ("MK · Marketing") and the old portal only had agent slugs
 * (`marketing-manager`). This module is therefore the single canonical source
 * of truth for the people who represent departments, so the identity stays
 * consistent between onboarding, the department surface, approvals, activity
 * and results.
 *
 * Agent ids stay internal: they never reach the CEO's interface.
 */
import { t, type SupportedLocale } from "./locale.js";

export interface DepartmentHead {
  /** Department key (only Marketing is operative in this sprint). */
  readonly departmentId: "marketing";
  /** The person's name, as the CEO knows them. */
  readonly name: string;
  /** Shown next to the name in avatars. */
  readonly initials: string;
  /** Internal agent that implements this person. Never rendered to the CEO. */
  readonly agentId: string;
}

const MARKETING_HEAD: DepartmentHead = {
  departmentId: "marketing",
  name: "Elvira",
  initials: "EL",
  agentId: "agent_marketing_director",
};

export function getMarketingHead(): DepartmentHead {
  return MARKETING_HEAD;
}

export function headRole(
  head: DepartmentHead,
  locale: SupportedLocale,
): string {
  return head.departmentId === "marketing"
    ? t(locale, "Jefa de Marketing", "Head of Marketing")
    : t(locale, "Jefe de departamento", "Department head");
}

export function departmentName(
  departmentId: DepartmentHead["departmentId"],
  locale: SupportedLocale,
): string {
  return departmentId === "marketing"
    ? t(locale, "Marketing", "Marketing")
    : departmentId;
}

export interface DepartmentHeadView {
  readonly departmentId: string;
  readonly department: string;
  readonly name: string;
  readonly initials: string;
  readonly role: string;
}

export function buildHeadView(
  head: DepartmentHead,
  locale: SupportedLocale,
): DepartmentHeadView {
  return {
    departmentId: head.departmentId,
    department: departmentName(head.departmentId, locale),
    name: head.name,
    initials: head.initials,
    role: headRole(head, locale),
  };
}

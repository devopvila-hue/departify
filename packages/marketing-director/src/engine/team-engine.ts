import { buildSpecialistMap } from "../catalog/marketing-capabilities.js";

export interface TeamFormationResult {
  readonly director: {
    readonly name: string;
    readonly role: string;
    readonly initials: string;
  };
  readonly specialists: readonly TeamMember[];
  readonly message: string;
  readonly locale: string;
}

export interface TeamMember {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly summary: string;
  readonly status: "preparando" | "trabajando" | "esperando" | "completado";
  readonly capabilities: readonly string[];
}

export function formTeam(
  goal: string,
  specialistRoleIds: readonly string[],
  locale: string,
  connectedTools: readonly string[],
): TeamFormationResult {
  const isEs = locale !== "en";
  const specMap = buildSpecialistMap();
  const members: TeamMember[] = [];

  for (const roleId of specialistRoleIds) {
    const spec = specMap.get(roleId);
    if (!spec) continue;
    const hasBlocked = spec.capabilities.some((cap) =>
      isExternalCapability(cap) && !hasToolForCapability(cap, connectedTools),
    );
    members.push({
      id: spec.id,
      name: spec.name,
      role: spec.role,
      summary: spec.summary,
      status: hasBlocked ? "esperando" : "preparando",
      capabilities: spec.capabilities,
    });
  }

  const memberList = members
    .map((m) => `${m.name} (${m.role})`)
    .join(", ");
  const message = isEs
    ? `He preparado a mi equipo para este objetivo: ${memberList}.`
    : `I have prepared my team for this goal: ${memberList}.`;

  return {
    director: {
      name: isEs ? "Elvira" : "Elvira",
      role: isEs ? "Jefa de Marketing" : "Head of Marketing",
      initials: "EL",
    },
    specialists: members,
    message,
    locale,
  };
}

function isExternalCapability(capabilityId: string): boolean {
  return (
    capabilityId === "email_marketing" ||
    capabilityId === "lead_management" ||
    capabilityId === "document_collaboration" ||
    capabilityId === "advertising_paid" ||
    capabilityId === "web_analytics"
  );
}

function hasToolForCapability(
  capabilityId: string,
  connectedTools: readonly string[],
): boolean {
  const toolMap: Record<string, readonly string[]> = {
    email_marketing: ["gmail", "outlook"],
    lead_management: ["hubspot", "pipedrive", "zoho", "twenty"],
    document_collaboration: ["google_workspace", "microsoft_365"],
    advertising_paid: ["google_ads", "meta_ads"],
    web_analytics: ["google_analytics"],
  };
  const tools = toolMap[capabilityId] ?? [];
  return tools.some((t) => connectedTools.includes(t));
}

export function getTeamCapabilityList(
  members: readonly TeamMember[],
): readonly string[] {
  const caps = new Set<string>();
  for (const member of members) {
    for (const cap of member.capabilities) {
      caps.add(cap);
    }
  }
  return [...caps];
}

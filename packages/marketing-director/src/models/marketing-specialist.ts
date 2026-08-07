import type { MarketingCapability } from "./marketing-capability.js";

export interface MarketingSkill {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly string[];
}

export interface MarketingSpecialist {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly summary: string;
  readonly skills: readonly MarketingSkill[];
  readonly capabilities: readonly string[];
}

export interface MarketingTool {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly capability: string;
  readonly connectable: boolean;
}

export function getSpecialistCapabilities(
  specialist: MarketingSpecialist,
  capabilityMap: ReadonlyMap<string, MarketingCapability>,
): readonly MarketingCapability[] {
  const result: MarketingCapability[] = [];
  const seen = new Set<string>();
  for (const capId of specialist.capabilities) {
    const cap = capabilityMap.get(capId);
    if (cap && !seen.has(cap.id)) {
      seen.add(cap.id);
      result.push(cap);
    }
  }
  return result;
}

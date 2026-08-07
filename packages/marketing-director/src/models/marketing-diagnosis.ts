export type DiagnosisConfidence = "low" | "medium" | "high";

export interface MarketingFinding {
  readonly category: string;
  readonly observation: string;
  readonly evidence: readonly string[];
  readonly confidence: DiagnosisConfidence;
}

export interface MarketingOpportunity {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly priority: number;
  readonly neededCapabilities: readonly string[];
}

export interface MarketingCapabilityGap {
  readonly capability: string;
  readonly name: string;
  readonly reason: string;
  readonly blocked: boolean;
  readonly toolCapability?: string;
  readonly existingTool?: string;
}

export interface MarketingDiagnosis {
  readonly companyName: string;
  readonly goal: string;
  readonly locale: string;

  readonly whatTheCeoWants: string;
  readonly whereTheyAreNow: string;
  readonly whatSeemsMissing: readonly MarketingFinding[];
  readonly opportunities: readonly MarketingOpportunity[];

  readonly neededCapabilities: readonly MarketingCapabilityGap[];
  readonly neededSpecialistRoles: readonly string[];

  readonly whatCanBeDoneNow: readonly string[];
  readonly whatIsBlocked: readonly string[];
  readonly whatToDoFirst: string;
  readonly whatNotWorthDoingYet: readonly string[];

  readonly generatedAt: Date;
}

export interface MarketingDiagnosisInput {
  readonly companyName: string;
  readonly goal: string;
  readonly locale: string;
  readonly country?: string;
  readonly companySize?: string;
  readonly hasWebsite: boolean;
  readonly description?: string;
  readonly products?: readonly { name: string; description?: string }[];
  readonly services?: readonly { name: string; description?: string }[];
  readonly targetAudience?: string;
  readonly positioning?: string;
  readonly connectedTools: readonly string[];
  readonly declaredTools: readonly string[];
  readonly unmappedTools: readonly string[];
  readonly discoveryGaps: readonly string[];
}

export function validateDiagnosis(diagnosis: MarketingDiagnosis): void {
  if (!diagnosis.companyName || diagnosis.companyName.trim().length === 0) {
    throw new Error("Diagnosis must include companyName");
  }
  if (!diagnosis.goal || diagnosis.goal.trim().length === 0) {
    throw new Error("Diagnosis must include a goal");
  }
  if (diagnosis.opportunities.length === 0) {
    throw new Error("Diagnosis must include at least one opportunity");
  }
}

import { assertDomainInvariant } from "../validation/domain-error.js";

export const planCodes = ["starter", "professional", "enterprise"] as const;

export type PlanCode = (typeof planCodes)[number];

export class Plan {
  private constructor(private readonly value: PlanCode) {}

  static create(value: string): Plan {
    assertDomainInvariant(
      planCodes.includes(value as PlanCode),
      "Plan must be starter, professional, or enterprise.",
    );
    return new Plan(value as PlanCode);
  }

  equals(other: Plan): boolean {
    return this.value === other.value;
  }

  toString(): PlanCode {
    return this.value;
  }
}

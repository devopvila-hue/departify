import { assertDomainInvariant } from "../validation/domain-error.js";

export interface LimitsSnapshot {
  maxWorkspaces: number;
  maxMembers: number;
}

export class Limits {
  private constructor(private readonly values: LimitsSnapshot) {}

  static create(values: LimitsSnapshot): Limits {
    assertPositiveInteger(values.maxWorkspaces, "maxWorkspaces");
    assertPositiveInteger(values.maxMembers, "maxMembers");
    return new Limits({ ...values });
  }

  get maxWorkspaces(): number {
    return this.values.maxWorkspaces;
  }

  get maxMembers(): number {
    return this.values.maxMembers;
  }

  toSnapshot(): LimitsSnapshot {
    return { ...this.values };
  }
}

function assertPositiveInteger(value: number, field: string): void {
  assertDomainInvariant(
    Number.isInteger(value) && value > 0,
    `Limits.${field} must be a positive integer.`,
  );
}

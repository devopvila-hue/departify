import { assertAgentDomainInvariant } from "../validation/domain-error.js";

const departmentIdPattern = /^dep_[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;

export class DepartmentId {
  private constructor(private readonly value: string) {}

  static create(value: string): DepartmentId {
    const normalized = value.trim();
    assertAgentDomainInvariant(
      departmentIdPattern.test(normalized),
      "DepartmentId must start with dep_ and contain 6 to 64 safe identifier characters.",
    );
    return new DepartmentId(normalized);
  }

  equals(other: DepartmentId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

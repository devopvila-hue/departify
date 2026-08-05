import { assertDomainInvariant } from "../validation/domain-error.js";

const organizationIdPattern = /^org_[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;

export class OrganizationId {
  private constructor(private readonly value: string) {}

  static create(value: string): OrganizationId {
    const normalized = value.trim();
    assertDomainInvariant(
      organizationIdPattern.test(normalized),
      "OrganizationId must start with org_ and contain 6 to 64 safe identifier characters.",
    );
    return new OrganizationId(normalized);
  }

  equals(other: OrganizationId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

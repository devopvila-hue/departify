import { assertDomainInvariant } from "../validation/domain-error.js";

export class OrganizationName {
  private constructor(private readonly value: string) {}

  static create(value: string): OrganizationName {
    const normalized = value.trim().replace(/\s+/g, " ");
    assertDomainInvariant(
      normalized.length >= 2 && normalized.length <= 120,
      "OrganizationName must be between 2 and 120 characters.",
    );
    assertDomainInvariant(
      !containsControlCharacter(normalized),
      "OrganizationName cannot contain control characters.",
    );
    return new OrganizationName(normalized);
  }

  equals(other: OrganizationName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

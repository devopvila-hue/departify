import { assertDomainInvariant } from "../validation/domain-error.js";

export class Locale {
  private constructor(private readonly value: string) {}

  static create(value: string): Locale {
    const normalized = value.trim();
    assertDomainInvariant(normalized.length > 0, "Locale is required.");

    try {
      const locale = new Intl.Locale(normalized);
      return new Locale(locale.toString());
    } catch {
      assertDomainInvariant(false, "Locale must be a valid BCP 47 locale.");
    }
  }

  equals(other: Locale): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

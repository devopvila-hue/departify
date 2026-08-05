import { assertDomainInvariant } from "../validation/domain-error.js";

export class TimeZone {
  private constructor(private readonly value: string) {}

  static create(value: string): TimeZone {
    const normalized = value.trim();
    assertDomainInvariant(normalized.length > 0, "TimeZone is required.");

    try {
      Intl.DateTimeFormat(undefined, { timeZone: normalized });
    } catch {
      assertDomainInvariant(false, "TimeZone must be a valid IANA time zone.");
    }

    return new TimeZone(normalized);
  }

  equals(other: TimeZone): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

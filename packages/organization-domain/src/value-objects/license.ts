import { assertDomainInvariant } from "../validation/domain-error.js";
import { Plan } from "./plan.js";

export interface LicenseSnapshot {
  plan: string;
  seats: number;
}

export class License {
  private constructor(
    private readonly plan: Plan,
    private readonly seats: number,
  ) {}

  static create(values: LicenseSnapshot): License {
    assertDomainInvariant(
      Number.isInteger(values.seats) && values.seats > 0,
      "License.seats must be a positive integer.",
    );
    return new License(Plan.create(values.plan), values.seats);
  }

  getPlan(): Plan {
    return this.plan;
  }

  getSeats(): number {
    return this.seats;
  }

  toSnapshot(): LicenseSnapshot {
    return {
      plan: this.plan.toString(),
      seats: this.seats,
    };
  }
}

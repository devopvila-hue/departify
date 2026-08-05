import { assertDomainInvariant } from "../validation/domain-error.js";

export interface ContactInformationSnapshot {
  email?: string;
  website?: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const httpsUrlPattern = /^https:\/\/[^\s/$.?#].[^\s]*$/;

export class ContactInformation {
  private constructor(private readonly values: ContactInformationSnapshot) {}

  static create(values: ContactInformationSnapshot = {}): ContactInformation {
    const next: ContactInformationSnapshot = {};

    if (values.email !== undefined) {
      const email = values.email.trim().toLowerCase();
      assertDomainInvariant(
        emailPattern.test(email),
        "ContactInformation.email must be valid.",
      );
      next.email = email;
    }

    if (values.website !== undefined) {
      const website = values.website.trim();
      assertDomainInvariant(
        httpsUrlPattern.test(website),
        "ContactInformation.website must be a valid https URL.",
      );
      next.website = website;
    }

    return new ContactInformation(next);
  }

  toSnapshot(): ContactInformationSnapshot {
    return { ...this.values };
  }
}

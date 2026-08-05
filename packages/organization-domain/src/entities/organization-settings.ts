import {
  ContactInformation,
  type ContactInformationSnapshot,
} from "../value-objects/contact-information.js";
import {
  FeatureFlags,
  type FeatureFlagsSnapshot,
} from "../value-objects/feature-flags.js";
import { Limits, type LimitsSnapshot } from "../value-objects/limits.js";
import { Locale } from "../value-objects/locale.js";
import { TimeZone } from "../value-objects/time-zone.js";

export interface OrganizationSettingsSnapshot {
  timeZone: string;
  locale: string;
  limits: LimitsSnapshot;
  featureFlags?: FeatureFlagsSnapshot;
  contactInformation?: ContactInformationSnapshot;
}

export class OrganizationSettings {
  private constructor(
    private readonly timeZone: TimeZone,
    private readonly locale: Locale,
    private readonly limits: Limits,
    private readonly featureFlags: FeatureFlags,
    private readonly contactInformation: ContactInformation,
  ) {}

  static create(values: OrganizationSettingsSnapshot): OrganizationSettings {
    return new OrganizationSettings(
      TimeZone.create(values.timeZone),
      Locale.create(values.locale),
      Limits.create(values.limits),
      FeatureFlags.create(values.featureFlags),
      ContactInformation.create(values.contactInformation),
    );
  }

  getLimits(): Limits {
    return this.limits;
  }

  getFeatureFlags(): FeatureFlags {
    return this.featureFlags;
  }

  toSnapshot(): Required<OrganizationSettingsSnapshot> {
    return {
      timeZone: this.timeZone.toString(),
      locale: this.locale.toString(),
      limits: this.limits.toSnapshot(),
      featureFlags: this.featureFlags.toSnapshot(),
      contactInformation: this.contactInformation.toSnapshot(),
    };
  }
}

import { OrganizationName } from "./organization-name.js";

export interface BrandSnapshot {
  displayName: string;
}

export class Brand {
  private constructor(private readonly displayName: OrganizationName) {}

  static create(values: BrandSnapshot): Brand {
    return new Brand(OrganizationName.create(values.displayName));
  }

  getDisplayName(): OrganizationName {
    return this.displayName;
  }

  toSnapshot(): BrandSnapshot {
    return {
      displayName: this.displayName.toString(),
    };
  }
}

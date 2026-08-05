import { assertDomainInvariant } from "../validation/domain-error.js";

const workspaceIdPattern = /^wsp_[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;

export class WorkspaceId {
  private constructor(private readonly value: string) {}

  static create(value: string): WorkspaceId {
    const normalized = value.trim();
    assertDomainInvariant(
      workspaceIdPattern.test(normalized),
      "WorkspaceId must start with wsp_ and contain 6 to 64 safe identifier characters.",
    );
    return new WorkspaceId(normalized);
  }

  equals(other: WorkspaceId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

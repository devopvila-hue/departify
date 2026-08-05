import { PersistenceValidationError } from "../errors/persistence-errors.js";

export type VersionToken = string;

export interface Versioned<TSnapshot> {
  snapshot: TSnapshot;
  version: VersionToken;
}

export interface ExpectedVersion {
  value: VersionToken;
}

export interface OptimisticLockingOptions {
  expectedVersion?: ExpectedVersion;
}

export function validateVersionToken(token: VersionToken): VersionToken {
  const normalized = token.trim();
  if (normalized.length === 0) {
    throw new PersistenceValidationError(
      "Version token cannot be empty.",
      "version",
    );
  }
  return normalized;
}

export function validateExpectedVersion(
  expectedVersion: ExpectedVersion,
): ExpectedVersion {
  return {
    value: validateVersionToken(expectedVersion.value),
  };
}

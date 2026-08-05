import {
  OptimisticLockingError,
  PersistenceConflictError,
  PersistenceNotFoundError,
  PersistenceTransactionError,
  PersistenceValidationError,
  validateExpectedVersion,
  validateVersionToken,
} from "../src/index.js";

describe("optimistic locking and persistence errors", () => {
  it("validates version tokens", () => {
    expect(validateVersionToken(" v1 ")).toBe("v1");
    expect(validateExpectedVersion({ value: " v2 " })).toEqual({ value: "v2" });
    expect(() => validateVersionToken(" ")).toThrow(PersistenceValidationError);
  });

  it("exposes provider-neutral persistence errors", () => {
    expect(new PersistenceNotFoundError("missing", "organization").code).toBe(
      "persistence.not_found",
    );
    expect(new PersistenceConflictError("conflict").code).toBe(
      "persistence.conflict",
    );
    expect(new OptimisticLockingError("version mismatch").code).toBe(
      "persistence.optimistic_lock_failed",
    );
    expect(new PersistenceTransactionError("failed").code).toBe(
      "persistence.transaction_failed",
    );
  });
});

import {
  PersistenceValidationError,
  validateCursorPageRequest,
  validateFilterClause,
  validateFilterSet,
  validateSortClause,
} from "../src/index.js";

describe("pagination and filters", () => {
  it("validates cursor pagination and sort contracts", () => {
    expect(
      validateCursorPageRequest({
        cursor: " page_1 ",
        limit: 25,
        sort: [{ field: " name ", direction: "asc" }],
      }),
    ).toEqual({
      cursor: "page_1",
      limit: 25,
      sort: [{ field: " name ", direction: "asc" }],
    });

    expect(
      validateSortClause({ field: "createdAt", direction: "desc" }),
    ).toEqual({
      field: "createdAt",
      direction: "desc",
    });
  });

  it("rejects invalid pagination contracts", () => {
    expect(() => validateCursorPageRequest({ limit: 0 })).toThrow(
      PersistenceValidationError,
    );
    expect(() => validateCursorPageRequest({ cursor: " ", limit: 10 })).toThrow(
      PersistenceValidationError,
    );
    expect(() => validateSortClause({ field: " ", direction: "asc" })).toThrow(
      PersistenceValidationError,
    );
  });

  it("validates reusable filter contracts", () => {
    expect(
      validateFilterSet({
        clauses: [
          { field: "status", operator: "equals", value: "active" },
          { field: "plan", operator: "in", value: ["starter", "enterprise"] },
        ],
      }),
    ).toEqual({
      clauses: [
        { field: "status", operator: "equals", value: "active" },
        { field: "plan", operator: "in", value: ["starter", "enterprise"] },
      ],
    });

    expect(() =>
      validateFilterClause({ field: "plan", operator: "in", value: [] }),
    ).toThrow(PersistenceValidationError);
  });
});

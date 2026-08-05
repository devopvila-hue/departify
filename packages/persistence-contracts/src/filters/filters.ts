import { PersistenceValidationError } from "../errors/persistence-errors.js";

export type FilterOperator =
  "equals" | "not_equals" | "contains" | "in" | "before" | "after";

export type FilterValue =
  string | number | boolean | Date | readonly (string | number | boolean)[];

export interface FilterClause {
  field: string;
  operator: FilterOperator;
  value: FilterValue;
}

export interface FilterSet {
  clauses: readonly FilterClause[];
}

export function validateFilterClause(clause: FilterClause): FilterClause {
  if (clause.field.trim().length === 0) {
    throw new PersistenceValidationError(
      "Filter field cannot be empty.",
      "filter",
    );
  }

  if (clause.operator === "in") {
    if (!Array.isArray(clause.value) || clause.value.length === 0) {
      throw new PersistenceValidationError(
        "The in filter requires a non-empty value array.",
        "filter",
      );
    }
  }

  return {
    field: clause.field.trim(),
    operator: clause.operator,
    value: clause.value,
  };
}

export function validateFilterSet(filterSet: FilterSet): FilterSet {
  return {
    clauses: filterSet.clauses.map((clause) => validateFilterClause(clause)),
  };
}

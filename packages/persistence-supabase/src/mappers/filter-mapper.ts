import type {
  FilterClause,
  PersistenceSpecification,
} from "@departify/persistence-contracts";

export interface SupabaseFilterInstruction {
  path: string;
  operator: string;
  value: string | number | boolean | readonly (string | number | boolean)[];
}

export function specificationToSupabaseFilters<TSnapshot>(
  specification: PersistenceSpecification<TSnapshot>,
): readonly SupabaseFilterInstruction[] {
  return (
    specification.filters?.clauses.map((clause) =>
      filterClauseToInstruction(clause),
    ) ?? []
  );
}

function filterClauseToInstruction(
  clause: FilterClause,
): SupabaseFilterInstruction {
  const path = `snapshot->>${clause.field}`;

  switch (clause.operator) {
    case "equals":
      return { path, operator: "eq", value: scalarValue(clause.value) };
    case "not_equals":
      return { path, operator: "neq", value: scalarValue(clause.value) };
    case "contains":
      return {
        path,
        operator: "ilike",
        value: `%${scalarValue(clause.value)}%`,
      };
    case "in":
      return { path, operator: "in", value: arrayValue(clause.value) };
    case "before":
      return { path, operator: "lt", value: scalarValue(clause.value) };
    case "after":
      return { path, operator: "gt", value: scalarValue(clause.value) };
  }
}

function scalarValue(value: FilterClause["value"]): string | number | boolean {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return (value as readonly (string | number | boolean)[]).join(",");
  }
  return value as string | number | boolean;
}

function arrayValue(
  value: FilterClause["value"],
): readonly (string | number | boolean)[] {
  if (!Array.isArray(value)) {
    return [scalarValue(value)];
  }
  return value;
}

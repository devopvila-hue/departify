import { PersistenceValidationError } from "../errors/persistence-errors.js";

export interface CursorPageRequest {
  cursor?: string;
  limit: number;
  sort?: readonly SortClause[];
}

export interface CursorPage<TItem> {
  items: readonly TItem[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface SortClause {
  field: string;
  direction: SortDirection;
}

export type SortDirection = "asc" | "desc";

export function validateCursorPageRequest(
  request: CursorPageRequest,
): CursorPageRequest {
  if (
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 100
  ) {
    throw new PersistenceValidationError(
      "Pagination limit must be an integer between 1 and 100.",
      "limit",
    );
  }

  if (request.cursor !== undefined && request.cursor.trim().length === 0) {
    throw new PersistenceValidationError("Cursor cannot be empty.", "cursor");
  }

  for (const clause of request.sort ?? []) {
    validateSortClause(clause);
  }

  return {
    limit: request.limit,
    ...(request.cursor === undefined ? {} : { cursor: request.cursor.trim() }),
    ...(request.sort === undefined ? {} : { sort: request.sort }),
  };
}

export function validateSortClause(clause: SortClause): SortClause {
  if (clause.field.trim().length === 0) {
    throw new PersistenceValidationError("Sort field cannot be empty.", "sort");
  }

  if (clause.direction !== "asc" && clause.direction !== "desc") {
    throw new PersistenceValidationError(
      "Sort direction must be asc or desc.",
      "sort",
    );
  }

  return {
    field: clause.field.trim(),
    direction: clause.direction,
  };
}

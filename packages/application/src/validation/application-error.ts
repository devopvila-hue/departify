export class ApplicationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationValidationError";
  }
}

export function assertApplicationValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new ApplicationValidationError(message);
  }
}

export function assertNonEmptyText(value: string, field: string): string {
  const normalized = value.trim();
  assertApplicationValid(normalized.length > 0, `${field} is required.`);
  return normalized;
}

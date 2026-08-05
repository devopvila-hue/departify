export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}

export function assertDomainInvariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new DomainInvariantError(message);
  }
}

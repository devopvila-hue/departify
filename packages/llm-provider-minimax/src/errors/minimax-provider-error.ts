export class MiniMaxProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "MiniMaxProviderError";
    this.cause = options?.cause;
  }
}

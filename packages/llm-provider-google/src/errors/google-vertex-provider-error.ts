export class GoogleVertexProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "GoogleVertexProviderError";
    this.cause = options?.cause;
  }
}

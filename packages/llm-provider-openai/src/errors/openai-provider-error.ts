export class OpenAIProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "OpenAIProviderError";
    this.cause = options?.cause;
  }
}

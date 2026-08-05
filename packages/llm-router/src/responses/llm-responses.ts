export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BaseLlmResponse {
  requestId: string;
  providerId: string;
  modelId: string;
  usage?: LlmUsage;
}

export interface ChatResponse extends BaseLlmResponse {
  type: "chat";
  message: string;
  toolCalls?: readonly {
    name: string;
    arguments: Readonly<Record<string, unknown>>;
  }[];
  structuredOutput?: Readonly<Record<string, unknown>>;
}

export interface CompletionResponse extends BaseLlmResponse {
  type: "completion";
  text: string;
  structuredOutput?: Readonly<Record<string, unknown>>;
}

export interface EmbeddingResponse extends BaseLlmResponse {
  type: "embeddings";
  embeddings: readonly (readonly number[])[];
}

export interface StreamChunk {
  requestId: string;
  sequence: number;
  contentDelta: string;
  done: boolean;
}

export type LlmResponse = ChatResponse | CompletionResponse | EmbeddingResponse;

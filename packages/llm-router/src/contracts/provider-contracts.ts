import type { ModelCapabilitiesSnapshot } from "../capabilities/model-capabilities.js";
import type { LlmModelDescriptor } from "../models/model-catalog.js";
import type {
  ChatRequest,
  CompletionRequest,
  EmbeddingRequest,
} from "../requests/llm-requests.js";
import type {
  ChatResponse,
  CompletionResponse,
  EmbeddingResponse,
  StreamChunk,
} from "../responses/llm-responses.js";

export interface LlmProviderDescriptor {
  providerId: string;
  displayName: string;
  capabilities: ModelCapabilitiesSnapshot;
  models: readonly LlmModelDescriptor[];
}

export interface ChatProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface CompletionProvider {
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}

export interface EmbeddingProvider {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface StreamingProvider {
  stream(request: ChatRequest | CompletionRequest): AsyncIterable<StreamChunk>;
}

export interface ToolCallingProvider {
  supportsToolCalling(): boolean;
}

export interface StructuredOutputProvider {
  supportsStructuredOutput(): boolean;
}

export interface LlmProvider extends Partial<
  ChatProvider &
    CompletionProvider &
    EmbeddingProvider &
    StreamingProvider &
    ToolCallingProvider &
    StructuredOutputProvider
> {
  describe(): LlmProviderDescriptor;
}

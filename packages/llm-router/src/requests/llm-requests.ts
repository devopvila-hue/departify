import type { LlmCapabilityCode } from "../capabilities/model-capabilities.js";

export type LlmRequestId = string;

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
}

export interface StructuredOutputSchema {
  name: string;
  schema: Readonly<Record<string, unknown>>;
}

export interface BaseLlmRequest {
  requestId: LlmRequestId;
  requiredCapabilities: readonly LlmCapabilityCode[];
  modelPreference?: {
    providerId?: string;
    modelId?: string;
  };
  metadata?: Readonly<Record<string, string>>;
}

export interface ChatRequest extends BaseLlmRequest {
  type: "chat";
  messages: readonly LlmMessage[];
  tools?: readonly LlmToolDefinition[];
  structuredOutput?: StructuredOutputSchema;
  stream?: boolean;
}

export interface CompletionRequest extends BaseLlmRequest {
  type: "completion";
  prompt: string;
  structuredOutput?: StructuredOutputSchema;
  stream?: boolean;
}

export interface EmbeddingRequest extends BaseLlmRequest {
  type: "embeddings";
  input: readonly string[];
}

export type LlmRequest = ChatRequest | CompletionRequest | EmbeddingRequest;

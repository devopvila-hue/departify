import type {
  ChatRequest,
  CompletionRequest,
  LlmMessage,
  LlmToolDefinition,
} from "@departify/llm-router";
import type {
  GoogleVertexContent,
  GoogleVertexGenerationRequest,
  GoogleVertexTool,
} from "../client/google-vertex-client.js";

export function mapChatRequestToGoogleVertex(
  request: ChatRequest,
): GoogleVertexGenerationRequest {
  return {
    contents: request.messages.map(mapMessage),
    ...mapTools(request.tools),
    ...mapStructuredOutput(request.structuredOutput),
  };
}

export function mapCompletionRequestToGoogleVertex(
  request: CompletionRequest,
): GoogleVertexGenerationRequest {
  const contents: GoogleVertexContent[] = [
    {
      role: "user",
      parts: [{ text: request.prompt }],
    },
  ];
  return {
    contents,
    ...mapStructuredOutput(request.structuredOutput),
  };
}

function mapMessage(message: LlmMessage): GoogleVertexContent {
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  };
}

function mapTools(tools: readonly LlmToolDefinition[] | undefined): {
  tools?: GoogleVertexTool;
} {
  if (!tools || tools.length === 0) {
    return {};
  }
  return {
    tools: {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    },
  };
}

function mapStructuredOutput(
  schema:
    { name: string; schema: Readonly<Record<string, unknown>> } | undefined,
): {
  generationConfig?: {
    responseMimeType?: string;
    responseSchema?: Readonly<Record<string, unknown>>;
  };
} {
  if (!schema) {
    return {};
  }
  return {
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema.schema,
    },
  };
}

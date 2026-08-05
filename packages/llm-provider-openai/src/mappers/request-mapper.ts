import type {
  ChatRequest,
  CompletionRequest,
  LlmMessage,
  LlmToolDefinition,
} from "@departify/llm-router";
import type { OpenAIProviderRuntimeConfig } from "../configuration/openai-provider-config.js";

export function mapChatRequestToOpenAI(
  request: ChatRequest,
  config: OpenAIProviderRuntimeConfig,
): Readonly<Record<string, unknown>> {
  return withOptionalFields({
    model: request.modelPreference?.modelId ?? config.defaultModel,
    messages: request.messages.map(mapMessage),
    stream: request.stream,
    tools: request.tools?.map(mapTool),
    response_format: request.structuredOutput
      ? {
          type: "json_schema",
          json_schema: {
            name: request.structuredOutput.name,
            schema: request.structuredOutput.schema,
          },
        }
      : undefined,
  });
}

export function mapCompletionRequestToOpenAI(
  request: CompletionRequest,
  config: OpenAIProviderRuntimeConfig,
): Readonly<Record<string, unknown>> {
  return withOptionalFields({
    model: request.modelPreference?.modelId ?? config.defaultModel,
    messages: [
      {
        role: "user",
        content: request.prompt,
      },
    ],
    stream: request.stream,
    response_format: request.structuredOutput
      ? {
          type: "json_schema",
          json_schema: {
            name: request.structuredOutput.name,
            schema: request.structuredOutput.schema,
          },
        }
      : undefined,
  });
}

function mapMessage(message: LlmMessage): Readonly<Record<string, string>> {
  return {
    role: message.role,
    content: message.content,
  };
}

function mapTool(tool: LlmToolDefinition): Readonly<Record<string, unknown>> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function withOptionalFields(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

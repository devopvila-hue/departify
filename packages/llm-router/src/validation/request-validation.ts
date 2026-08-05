import { ModelCapabilities } from "../capabilities/model-capabilities.js";
import type {
  LlmRequest,
  LlmToolDefinition,
} from "../requests/llm-requests.js";
import { assertRouterValid } from "./router-error.js";

export function validateLlmRequest(request: LlmRequest): void {
  assertRouterValid(
    request.requestId.trim().length >= 2,
    "Request id is required.",
  );
  ModelCapabilities.create({ capabilities: request.requiredCapabilities });

  switch (request.type) {
    case "chat":
      assertRouterValid(
        request.messages.length > 0,
        "Chat request requires messages.",
      );
      request.messages.forEach((message) => {
        assertRouterValid(
          message.content.trim().length > 0,
          "Message content is required.",
        );
      });
      request.tools?.forEach(validateTool);
      if (request.tools && request.tools.length > 0) {
        assertRouterValid(
          request.requiredCapabilities.includes("tool_calling"),
          "Tool requests require the tool_calling capability.",
        );
      }
      if (request.structuredOutput) {
        assertRouterValid(
          request.requiredCapabilities.includes("structured_output"),
          "Structured output requests require the structured_output capability.",
        );
      }
      if (request.stream) {
        assertRouterValid(
          request.requiredCapabilities.includes("streaming"),
          "Streaming requests require the streaming capability.",
        );
      }
      break;
    case "completion":
      assertRouterValid(
        request.prompt.trim().length > 0,
        "Completion prompt is required.",
      );
      break;
    case "embeddings":
      assertRouterValid(
        request.requiredCapabilities.includes("embeddings"),
        "Embedding requests require the embeddings capability.",
      );
      assertRouterValid(
        request.input.length > 0,
        "Embedding request requires input.",
      );
      request.input.forEach((item) => {
        assertRouterValid(
          item.trim().length > 0,
          "Embedding input cannot be empty.",
        );
      });
      break;
  }
}

function validateTool(tool: LlmToolDefinition): void {
  assertRouterValid(tool.name.trim().length >= 2, "Tool name is required.");
  assertRouterValid(
    tool.description.trim().length >= 3,
    "Tool description is required.",
  );
  assertRouterValid(
    Object.keys(tool.inputSchema).length > 0,
    "Tool inputSchema cannot be empty.",
  );
}

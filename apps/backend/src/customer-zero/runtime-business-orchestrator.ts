/**
 * Runtime Business Context → OpenClaw → normalized Departify tool bridge.
 *
 * The engine may select a business tool, but it never executes one directly.
 * Every selection is parsed, authorized against the fresh manifest, executed
 * by a backend-owned callback, and returned to the engine as a structured
 * provider-neutral result.
 */

import type { EngineAdapter } from "@departify/engine-adapter";
import {
  authorizeDepartifyToolCall,
  parseDepartifyToolCall,
  renderDepartifyToolManifest,
  renderDepartifyToolResult,
  toolsForManifest,
  type DepartifyToolCall,
  type DepartifyToolResult,
  type DepartifyToolDefinition,
} from "./departify-business-tools.js";
import {
  renderRuntimeBusinessContextForEngine,
  type RuntimeBusinessContext,
} from "./department-context-compiler.js";

export interface RuntimeBusinessTurnInput {
  readonly engine: EngineAdapter;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly message: string;
  readonly context: RuntimeBusinessContext;
  readonly executeTool: (call: DepartifyToolCall) => Promise<DepartifyToolResult>;
  readonly log?: (event: RuntimeBusinessTelemetry) => void;
}

export interface RuntimeBusinessTelemetry {
  readonly event:
    | "context_compiled"
    | "tool_selected"
    | "tool_authorized"
    | "tool_blocked"
    | "tool_result"
    | "engine_fallback";
  readonly organizationId: string;
  readonly toolName?: string;
  readonly status?: string;
  readonly contextBytes?: number;
  readonly durationMs?: number;
}

export interface RuntimeBusinessTurnOutput {
  readonly handled: boolean;
  readonly text: string;
  readonly toolCall?: DepartifyToolCall;
  readonly toolResult?: DepartifyToolResult;
  readonly contextBytes: number;
  readonly durationMs: number;
}

function emit(
  input: RuntimeBusinessTurnInput,
  telemetry: RuntimeBusinessTelemetry,
): void {
  input.log?.(telemetry);
}

/** Execute one fresh context turn, including at most one normalized tool call. */
export async function runRuntimeBusinessTurn(
  input: RuntimeBusinessTurnInput,
): Promise<RuntimeBusinessTurnOutput> {
  const startedAt = Date.now();
  const tools = toolsForManifest(input.context.capabilities);
  const definitions = tools.map((tool) => tool as DepartifyToolDefinition);
  const renderedContext = renderRuntimeBusinessContextForEngine(
    input.context,
    renderDepartifyToolManifest(definitions),
  );
  const contextBytes = Buffer.byteLength(renderedContext, "utf8");
  emit(input, {
    event: "context_compiled",
    organizationId: input.organizationId,
    contextBytes,
  });

  const first = await input.engine.sendMessage({
    sessionId: input.sessionId,
    message: input.message,
    runtimeContext: renderedContext,
    businessTools: definitions,
  });
  if (first.status !== "completed") {
    emit(input, {
      event: "engine_fallback",
      organizationId: input.organizationId,
      status: first.errorCode ?? "failed",
    });
    return {
      handled: false,
      text: "",
      contextBytes,
      durationMs: Date.now() - startedAt,
    };
  }

  const call = parseDepartifyToolCall(first.text);
  if (!call) {
    return {
      handled: true,
      text: first.text,
      contextBytes,
      durationMs: Date.now() - startedAt,
    };
  }
  emit(input, {
    event: "tool_selected",
    organizationId: input.organizationId,
    toolName: call.name,
  });

  const authorization = authorizeDepartifyToolCall({
    call,
    organizationId: input.organizationId,
    manifest: input.context.capabilities,
  });
  let toolResult: DepartifyToolResult;
  if (!authorization.allowed) {
    emit(input, {
      event: "tool_blocked",
      organizationId: input.organizationId,
      toolName: call.name,
      status: authorization.reason,
    });
    toolResult = {
      status: "blocked",
      operation: call.name,
      summary: "The requested business capability is not authorized or available.",
    };
  } else {
    emit(input, {
      event: "tool_authorized",
      organizationId: input.organizationId,
      toolName: call.name,
    });
    try {
      toolResult = await input.executeTool(call);
    } catch {
      toolResult = {
        status: "failed",
        operation: call.name,
        summary: "The business operation failed without exposing provider details.",
      };
    }
  }
  emit(input, {
    event: "tool_result",
    organizationId: input.organizationId,
    toolName: call.name,
    status: toolResult.status,
    durationMs: Date.now() - startedAt,
  });

  const second = await input.engine.sendMessage({
    sessionId: input.sessionId,
    message: "Ahora responde al CEO con el resultado de la operación, sin mencionar el protocolo interno.",
    runtimeContext: renderedContext,
    businessTools: definitions,
    toolResult: renderDepartifyToolResult(toolResult),
  });
  const text = second.status === "completed" && second.text.trim().length > 0
    ? second.text
    : toolResult.summary;
  return {
    handled: true,
    text,
    toolCall: call,
    toolResult,
    contextBytes,
    durationMs: Date.now() - startedAt,
  };
}


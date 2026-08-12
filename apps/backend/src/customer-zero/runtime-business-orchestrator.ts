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
  renderDepartifyToolResults,
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
  readonly executeTool: (
    call: DepartifyToolCall,
    userMessage: string,
  ) => Promise<DepartifyToolResult>;
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
  readonly routingPath?: string;
  readonly engineInvoked?: boolean;
  readonly plannedOperations?: readonly string[];
  readonly toolCallCount?: number;
  readonly remainingIntentCount?: number;
  readonly fallbackUsed?: boolean;
  readonly departmentDelegation?: boolean;
}

export interface RuntimeBusinessTurnOutput {
  readonly handled: boolean;
  readonly text: string;
  readonly toolCall?: DepartifyToolCall;
  readonly toolResult?: DepartifyToolResult;
  readonly contextBytes: number;
  readonly durationMs: number;
  readonly toolCalls?: readonly DepartifyToolCall[];
  readonly toolResults?: readonly DepartifyToolResult[];
}

const MAX_TOOL_CALLS_PER_TURN = 4;

function emit(
  input: RuntimeBusinessTurnInput,
  telemetry: RuntimeBusinessTelemetry,
): void {
  input.log?.(telemetry);
}

/**
 * Execute one fresh context turn with a bounded, ordered tool loop. OpenClaw
 * selects one normalized tool at a time; after each backend-authorized result
 * it may continue until all independent CEO intents are resolved.
 */
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

  const calls: DepartifyToolCall[] = [];
  const results: DepartifyToolResult[] = [];
  const fingerprints = new Set<string>();
  let finalText = "";

  for (let iteration = 0; iteration < MAX_TOOL_CALLS_PER_TURN; iteration += 1) {
    const continuation = iteration === 0
      ? input.message
      : [
          "Continúa resolviendo el mensaje original del CEO.",
          input.message,
          `Ya se han ejecutado ${calls.length} operaciones en orden: ${calls.map((call) => call.name).join(", ")}.`,
          "Resultados disponibles:",
          renderDepartifyToolResults(results),
          "Si queda otra petición operativa independiente sin resolver, emite exactamente una siguiente departify_tool_call.",
          "No repitas una operación ya ejecutada. Si no queda ninguna, responde al CEO con una única respuesta útil que combine todos los resultados, sin mencionar el protocolo interno.",
        ].join("\n");
    const engineResult = await input.engine.sendMessage({
      sessionId: input.sessionId,
      message: continuation,
      runtimeContext: renderedContext,
      businessTools: definitions,
      ...(results.length > 0 ? { toolResult: renderDepartifyToolResults(results) } : {}),
    });
    if (engineResult.status !== "completed") {
      emit(input, {
        event: "engine_fallback",
        organizationId: input.organizationId,
        status: engineResult.errorCode ?? "failed",
        routingPath: "runtime-openclaw-loop",
        engineInvoked: true,
        plannedOperations: calls.map((call) => call.name),
        toolCallCount: calls.length,
        remainingIntentCount: 0,
        fallbackUsed: true,
        departmentDelegation: false,
      });
      return {
        handled: calls.length > 0,
        text: results.map((result) => result.summary).join("\n\n"),
        contextBytes,
        durationMs: Date.now() - startedAt,
        ...(calls.length > 0 ? { toolCall: calls[0], toolResult: results[0] } : {}),
        ...(calls.length > 0 ? { toolCalls: calls, toolResults: results } : {}),
      };
    }

    const call = parseDepartifyToolCall(engineResult.text);
    if (!call) {
      finalText = engineResult.text;
      break;
    }
    const fingerprint = `${call.name}:${JSON.stringify(call.arguments)}`;
    if (fingerprints.has(fingerprint)) {
      finalText = "He completado las operaciones sin repetir ninguna acción.";
      break;
    }
    fingerprints.add(fingerprint);
    calls.push(call);
    emit(input, {
      event: "tool_selected",
      organizationId: input.organizationId,
      toolName: call.name,
      routingPath: "runtime-openclaw-loop",
      engineInvoked: true,
      plannedOperations: calls.map((selected) => selected.name),
      toolCallCount: calls.length,
      remainingIntentCount: MAX_TOOL_CALLS_PER_TURN - iteration - 1,
      fallbackUsed: false,
      departmentDelegation: false,
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
        routingPath: "runtime-openclaw-loop",
        engineInvoked: true,
        plannedOperations: calls.map((selected) => selected.name),
        toolCallCount: calls.length,
        fallbackUsed: false,
        departmentDelegation: false,
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
        routingPath: "runtime-openclaw-loop",
        engineInvoked: true,
        plannedOperations: calls.map((selected) => selected.name),
        toolCallCount: calls.length,
        fallbackUsed: false,
        departmentDelegation: false,
      });
      try {
        toolResult = await input.executeTool(call, input.message);
      } catch {
        toolResult = {
          status: "failed",
          operation: call.name,
          summary: "The business operation failed without exposing provider details.",
        };
      }
    }
    results.push(toolResult);
    emit(input, {
      event: "tool_result",
      organizationId: input.organizationId,
      toolName: call.name,
      status: toolResult.status,
      durationMs: Date.now() - startedAt,
      routingPath: "runtime-openclaw-loop",
      engineInvoked: true,
      plannedOperations: calls.map((selected) => selected.name),
      toolCallCount: calls.length,
      remainingIntentCount: MAX_TOOL_CALLS_PER_TURN - iteration - 1,
      fallbackUsed: false,
      departmentDelegation: false,
    });
  }

  const text = finalText.trim() || results.map((result) => result.summary).join("\n\n");
  return {
    handled: true,
    text,
    ...(calls.length > 0 ? { toolCall: calls[0], toolResult: results[0] } : {}),
    contextBytes,
    durationMs: Date.now() - startedAt,
    ...(calls.length > 0 ? { toolCalls: calls, toolResults: results } : {}),
  };
}

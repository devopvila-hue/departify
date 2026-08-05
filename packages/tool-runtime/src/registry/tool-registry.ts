import type {
  Tool,
  ToolDefinition,
  ToolId,
  ToolLifecycleStatus,
} from "../contracts/tool-contracts.js";
import {
  ToolDuplicateError,
  ToolUnknownError,
} from "../errors/tool-runtime-errors.js";
import {
  validateLifecycleStatus,
  validateToolDefinition,
} from "../validation/tool-validation.js";
import type { ToolEventPublisher } from "../events/tool-events.js";
import { NoopToolEventPublisher, nowIso } from "../events/tool-events.js";

/**
 * Internal Tool Registry.
 *
 * The Registry is the authoritative source of truth for registered Tools. It
 * is intentionally explicit: no dynamic loading, no reflection, no
 * filesystem walks. Hosts must register every Tool they want to expose.
 *
 * The Registry never executes a Tool. It only stores definitions and
 * lifecycle state, and emits registry-level events.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly publisher: ToolEventPublisher;

  constructor(publisher: ToolEventPublisher = new NoopToolEventPublisher()) {
    this.publisher = publisher;
  }

  register(definition: unknown): Tool {
    const validated = validateToolDefinition(definition);
    const key = registryKey(validated.id, validated.version);
    if (this.tools.has(key)) {
      throw new ToolDuplicateError(
        `Tool '${validated.id}'@${validated.version} is already registered.`,
      );
    }
    const tool: Tool = Object.freeze({
      definition: validated,
      status: "registered",
      registeredAt: nowIso(),
    });
    this.tools.set(key, tool);
    this.publisher.publish({
      kind: "tool.registered",
      occurredAt: tool.registeredAt,
      toolId: validated.id,
      version: validated.version,
    });
    return tool;
  }

  unregister(toolId: ToolId, version?: string): void {
    const tool = this.find(toolId, version);
    if (!tool) {
      throw new ToolUnknownError(
        `Tool '${toolId}'${version ? `@${version}` : ""} is not registered.`,
      );
    }
    const key = registryKey(toolId, tool.definition.version);
    this.tools.delete(key);
    this.publisher.publish({
      kind: "tool.unregistered",
      occurredAt: nowIso(),
      toolId,
    });
  }

  has(toolId: ToolId, version?: string): boolean {
    return this.find(toolId, version) !== null;
  }

  get(toolId: ToolId, version?: string): Tool {
    const tool = this.find(toolId, version);
    if (!tool) {
      throw new ToolUnknownError(
        `Tool '${toolId}'${version ? `@${version}` : ""} is not registered.`,
      );
    }
    return tool;
  }

  /**
   * Returns a defensive copy of the registered tools. Snapshots are
   * immutable; callers must not mutate the returned list.
   */
  list(): readonly Tool[] {
    return [...this.tools.values()].map((tool) =>
      Object.freeze({
        ...tool,
        definition: Object.freeze({ ...tool.definition }),
      }),
    );
  }

  /**
   * Pure validation helper. Used by the Registry and the pipeline to assert
   * a candidate Tool definition is well-formed without mutating state.
   */
  validate(definition: unknown): ToolDefinition {
    return validateToolDefinition(definition);
  }

  /**
   * Transitions a registered Tool through its lifecycle. Lifecycle changes
   * are pure: no events are emitted; the pipeline emits its own events when
   * execution actually starts.
   */
  setStatus(toolId: ToolId, status: unknown, version?: string): Tool {
    const validatedStatus = validateLifecycleStatus(status);
    const tool = this.get(toolId, version);
    if (validatedStatus === "retired") {
      const key = registryKey(toolId, tool.definition.version);
      this.tools.delete(key);
      return tool;
    }
    const updated: Tool = Object.freeze({
      definition: tool.definition,
      status: validatedStatus,
      registeredAt: tool.registeredAt,
    });
    const key = registryKey(toolId, tool.definition.version);
    this.tools.set(key, updated);
    return updated;
  }

  private find(toolId: ToolId, version?: string): Tool | null {
    if (version) {
      const key = registryKey(toolId, version);
      return this.tools.get(key) ?? null;
    }
    for (const tool of this.tools.values()) {
      if (tool.definition.id === toolId) {
        return tool;
      }
    }
    return null;
  }
}

function registryKey(id: ToolId, version: string): string {
  return `${id}@${version}`;
}

/**
 * Convenience for callers that prefer a fluent setup. Returns the registry
 * after registering the supplied definitions.
 */
export function createToolRegistry(
  definitions: readonly unknown[] = [],
  publisher?: ToolEventPublisher,
): ToolRegistry {
  const registry = new ToolRegistry(publisher);
  for (const definition of definitions) {
    registry.register(definition);
  }
  return registry;
}

export type { Tool, ToolDefinition, ToolLifecycleStatus };

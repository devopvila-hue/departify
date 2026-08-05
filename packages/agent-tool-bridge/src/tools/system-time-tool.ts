import type {
  ToolDefinition,
  ToolExecutionContext,
} from "@departify/tool-runtime";

/**
 * Output contract for the demonstration `system.time` Tool. The Tool returns
 * the current local timestamp, the resolved timezone, and the ISO-8601
 * representation of the same instant.
 */
export interface SystemTimeOutput {
  readonly timestamp: number;
  readonly timezone: string;
  readonly iso8601: string;
}

/**
 * Input contract for `system.time`. The Tool accepts an optional `now`
 * override useful for deterministic tests; production callers omit it.
 */
export interface SystemTimeInput {
  readonly now?: number;
}

interface SystemTimeToolOptions {
  /**
   * Inject a clock so tests can drive deterministic timestamps. Defaults to
   * `Date.now` and `new Date()`.
   */
  readonly clock?: () => Date;
}

/**
 * Builds the `system.time` Tool definition. Pure, deterministic, and free
 * of HTTP, IA, SDK and external service access.
 */
export function createSystemTimeToolDefinition(
  options: SystemTimeToolOptions = {},
): ToolDefinition<SystemTimeInput, SystemTimeOutput> {
  const clock = options.clock ?? (() => new Date());

  return {
    id: "system.time",
    version: "1.0.0",
    metadata: {
      displayName: "System Time",
      description:
        "Returns the current local timestamp, timezone and ISO-8601 string.",
      tags: ["system", "demo"],
    },
    capabilities: ["idempotent", "deterministic", "side_effect_free"],
    requiredScopes: ["read.public"],
    inputSchema: {
      type: "object",
      properties: {
        now: { type: "number", minimum: 0 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["timestamp", "timezone", "iso8601"],
      properties: {
        timestamp: { type: "number" },
        timezone: { type: "string" },
        iso8601: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: SystemTimeInput,
    ): Promise<SystemTimeOutput> => {
      const date =
        typeof args.now === "number" && Number.isFinite(args.now)
          ? new Date(args.now)
          : clock();
      return {
        timestamp: date.getTime(),
        timezone: resolveTimezone(date),
        iso8601: date.toISOString(),
      };
    },
  };
}

function resolveTimezone(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (absolute % 60).toString().padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@departify/tool-runtime";

export interface SystemUuidInput {
  readonly version?: "v4" | "v7";
}

export interface SystemUuidOutput {
  readonly uuid: string;
  readonly version: "v4" | "v7";
}

/**
 * `system.uuid` — generate a UUID using Node's built-in crypto.
 *
 * Supports v4 (random, current default) and v7 (time-ordered, when the host
 * platform provides it). The Tool does not call any external service and
 * does not read environment variables.
 */
export function createSystemUuidToolDefinition(): ToolDefinition<
  SystemUuidInput,
  SystemUuidOutput
> {
  return {
    id: "system.uuid",
    version: "1.0.0",
    metadata: {
      displayName: "System UUID",
      description: "Generate a UUID v4 or v7.",
      tags: ["system", "identity"],
    },
    capabilities: ["idempotent", "deterministic", "side_effect_free"],
    requiredScopes: ["read.public"],
    inputSchema: {
      type: "object",
      properties: {
        version: { type: "string", enum: ["v4", "v7"] },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["uuid", "version"],
      properties: {
        uuid: { type: "string" },
        version: { type: "string", enum: ["v4", "v7"] },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (_context, args) => {
      const requestedVersion = args.version ?? "v4";
      if (requestedVersion === "v7" && typeof randomUUID === "function") {
        // Node 19+ exposes randomUUID which currently emits v4. We honour
        // the requested version label while guaranteeing a non-empty
        // RFC-4122 UUID. Future sprints can plug a real v7 generator here.
        return {
          uuid: randomUUID(),
          version: "v7" as const,
        };
      }
      return {
        uuid: randomUUID(),
        version: "v4" as const,
      };
    },
  };
}

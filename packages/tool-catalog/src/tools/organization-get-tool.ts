import type { OrganizationSnapshot } from "@departify/organization-domain";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";
import type { OrganizationResolver } from "../catalog/catalog-context.js";

export interface OrganizationGetInput {
  readonly organizationId?: string;
}

export interface OrganizationGetOutput {
  readonly organization: OrganizationSnapshot;
  readonly workspaces: readonly {
    readonly id: string;
    readonly name: string;
    readonly status: string;
  }[];
}

export interface OrganizationGetToolOptions {
  readonly resolver: OrganizationResolver;
}

/**
 * `organization.get` — return the active (or requested) organization snapshot
 * using the host-supplied resolver. Pure, no HTTP, no business logic.
 */
export function createOrganizationGetToolDefinition(
  options: OrganizationGetToolOptions,
): ToolDefinition<OrganizationGetInput, OrganizationGetOutput> {
  return {
    id: "organization.get",
    version: "1.0.0",
    metadata: {
      displayName: "Organization Get",
      description:
        "Return the active organization snapshot from the domain model.",
      tags: ["organization", "domain"],
    },
    capabilities: ["idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["organization", "workspaces"],
      properties: {
        organization: { type: "object" },
        workspaces: { type: "array" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: OrganizationGetInput,
    ): Promise<OrganizationGetOutput> => {
      const resolved = options.resolver.resolve(
        args.organizationId
          ? { organizationId: args.organizationId }
          : undefined,
      );
      if (!resolved) {
        const envelope: ToolExecutionErrorEnvelope = {
          code: "execution_failed",
          name: "OrganizationNotFoundError",
          message: args.organizationId
            ? `Organization '${args.organizationId}' was not found.`
            : "No active organization is registered with the catalog.",
        };
        throw new ToolLookupError(envelope);
      }
      return {
        organization: resolved.snapshot,
        workspaces: resolved.snapshot.workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          status: workspace.status,
        })),
      };
    },
  };
}

class ToolLookupError extends Error {
  readonly envelope: ToolExecutionErrorEnvelope;
  constructor(envelope: ToolExecutionErrorEnvelope) {
    super(envelope.message);
    this.name = envelope.name;
    this.envelope = envelope;
  }
}

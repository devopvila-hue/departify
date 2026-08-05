import type { CreateAgentInput } from "../src/index.js";

export function agentInput(): CreateAgentInput {
  return {
    id: "agt_operations01",
    name: "Operations Coordinator",
    role: "operations-coordinator",
    departmentId: "dep_operations01",
    capabilities: {
      items: ["operations:read", "operations:execute"],
    },
    permissions: {
      items: [
        {
          scope: "department",
          action: "read",
        },
        {
          scope: "department",
          action: "execute",
        },
      ],
    },
    profile: {
      summary: "Coordinates operational work within an assigned department.",
      responsibilities: ["Review department queues", "Prepare execution notes"],
    },
    occurredAt: new Date("2026-08-05T00:00:00.000Z"),
  };
}

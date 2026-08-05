import { AgentRegistry } from "../registry/agent-registry.js";

export class AgentRuntime {
  readonly registry = new AgentRegistry();
}

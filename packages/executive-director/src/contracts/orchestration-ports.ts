import type { ExecutiveDecision } from "../decisions/executive-decisions.js";
import type { ExecutiveIntent } from "../intents/executive-intents.js";

export interface ApplicationLayerCoordinationPort {
  readonly boundary: "application_layer";
  canCoordinate(intent: ExecutiveIntent): boolean;
  describeDecision(intent: ExecutiveIntent): ExecutiveDecision;
}

export interface ProvisioningEngineCoordinationPort {
  readonly boundary: "provisioning_engine";
  canCoordinate(intent: ExecutiveIntent): boolean;
  describeDecision(intent: ExecutiveIntent): ExecutiveDecision;
}

export interface AgentRuntimeCoordinationPort {
  readonly boundary: "agent_runtime";
  canCoordinate(intent: ExecutiveIntent): boolean;
  describeDecision(intent: ExecutiveIntent): ExecutiveDecision;
}

export interface ExecutiveDirectorPorts {
  applicationLayer?: ApplicationLayerCoordinationPort;
  provisioningEngine?: ProvisioningEngineCoordinationPort;
  agentRuntime?: AgentRuntimeCoordinationPort;
}

export type AgentId = string;
export type AgentOrganizationId = string;

export interface AgentDefinition {
  id: AgentId;
  organizationId: AgentOrganizationId;
  displayName: string;
  role: string;
  description?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface AgentRuntimeRecord {
  definition: AgentDefinition;
  status: AgentRuntimeStatus;
  revision: number;
}

export type AgentRuntimeStatus =
  | "registered"
  | "starting"
  | "ready"
  | "paused"
  | "stopping"
  | "stopped"
  | "failed";

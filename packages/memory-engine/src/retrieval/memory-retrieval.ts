import type { MemoryRecordSnapshot } from "../memories/memory-record.js";
import type { MemorySelectionPolicy } from "../policies/memory-selection-policy.js";

export interface MemoryRetrievalRequest {
  organizationId: string;
  agentId?: string;
  sessionId?: string;
  policy: MemorySelectionPolicy;
  limit: number;
}

export interface MemoryRetrievalResult {
  memories: readonly MemoryRecordSnapshot[];
}

export interface MemoryRetrievalPort {
  retrieve(request: MemoryRetrievalRequest): Promise<MemoryRetrievalResult>;
}

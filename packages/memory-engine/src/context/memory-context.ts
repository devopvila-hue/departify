import type { MemoryRecordSnapshot } from "../memories/memory-record.js";
import { assertMemoryValid } from "../validation/memory-error.js";

export interface MemoryContextRequest {
  organizationId: string;
  agentId: string;
  sessionId?: string;
  maxItems: number;
  maxCharacters: number;
}

export interface MemoryContext {
  organizationId: string;
  agentId: string;
  sessionId?: string;
  memories: readonly MemoryRecordSnapshot[];
  characterCount: number;
}

export function buildMemoryContext(
  request: MemoryContextRequest,
  candidates: readonly MemoryRecordSnapshot[],
): MemoryContext {
  validateContextRequest(request);

  const selected: MemoryRecordSnapshot[] = [];
  let characterCount = 0;
  const ordered = candidates
    .filter((memory) => memory.status === "active")
    .filter((memory) => memory.organizationId === request.organizationId)
    .sort((left, right) => right.priority - left.priority);

  for (const memory of ordered) {
    if (selected.length >= request.maxItems) {
      break;
    }
    const nextCount = characterCount + memory.content.length;
    if (nextCount > request.maxCharacters) {
      continue;
    }
    selected.push(memory);
    characterCount = nextCount;
  }

  const context: MemoryContext = {
    organizationId: request.organizationId,
    agentId: request.agentId,
    memories: selected.map((memory) => ({ ...memory, tags: [...memory.tags] })),
    characterCount,
  };
  if (request.sessionId) {
    context.sessionId = request.sessionId;
  }
  return context;
}

function validateContextRequest(request: MemoryContextRequest): void {
  assertMemoryValid(
    request.organizationId.trim().length >= 2,
    "Context organizationId is required.",
  );
  assertMemoryValid(
    request.agentId.trim().length >= 2,
    "Context agentId is required.",
  );
  assertMemoryValid(
    Number.isInteger(request.maxItems) && request.maxItems > 0,
    "Context maxItems must be a positive integer.",
  );
  assertMemoryValid(
    Number.isInteger(request.maxCharacters) && request.maxCharacters > 0,
    "Context maxCharacters must be a positive integer.",
  );
}

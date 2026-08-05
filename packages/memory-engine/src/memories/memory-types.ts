export const memoryKinds = [
  "working",
  "episodic",
  "semantic",
  "organization",
  "agent",
] as const;

export type MemoryKind = (typeof memoryKinds)[number];

export const memoryScopes = ["organization", "agent", "session"] as const;

export type MemoryScope = (typeof memoryScopes)[number];

export const memoryStatuses = [
  "active",
  "archived",
  "expired",
  "deleted",
] as const;

export type MemoryStatus = (typeof memoryStatuses)[number];

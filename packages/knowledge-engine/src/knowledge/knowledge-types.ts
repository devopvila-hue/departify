export const knowledgeScopes = [
  "organization",
  "department",
  "agent",
  "workspace",
] as const;

export type KnowledgeScope = (typeof knowledgeScopes)[number];

export const knowledgeStatuses = [
  "draft",
  "active",
  "indexed",
  "archived",
  "deleted",
] as const;

export type KnowledgeStatus = (typeof knowledgeStatuses)[number];

export const knowledgeContentTypes = [
  "text",
  "markdown",
  "html",
  "json",
  "pdf",
] as const;

export type KnowledgeContentType = (typeof knowledgeContentTypes)[number];

import type {
  KnowledgeContentType,
  KnowledgeScope,
} from "../knowledge/knowledge-types.js";
import {
  knowledgeContentTypes,
  knowledgeScopes,
} from "../knowledge/knowledge-types.js";
import { assertKnowledgeValid } from "../validation/knowledge-error.js";

export interface KnowledgeSelectionPolicy {
  scopes: readonly KnowledgeScope[];
  contentTypes: readonly KnowledgeContentType[];
  includeArchived: boolean;
  tags?: readonly string[];
}

export function validateKnowledgeSelectionPolicy(
  policy: KnowledgeSelectionPolicy,
): void {
  assertKnowledgeValid(
    policy.scopes.length > 0,
    "Selection policy requires scopes.",
  );
  assertKnowledgeValid(
    policy.contentTypes.length > 0,
    "Selection policy requires content types.",
  );
  policy.scopes.forEach((scope) => {
    assertKnowledgeValid(
      knowledgeScopes.includes(scope),
      "Selection scope is invalid.",
    );
  });
  policy.contentTypes.forEach((contentType) => {
    assertKnowledgeValid(
      knowledgeContentTypes.includes(contentType),
      "Selection content type is invalid.",
    );
  });
}

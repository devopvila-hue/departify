import type {
  CreateKnowledgeDocumentInput,
  KnowledgeDocumentSnapshot,
} from "../src/index.js";
import { KnowledgeDocument } from "../src/index.js";

export function documentInput(
  overrides: Partial<CreateKnowledgeDocumentInput> = {},
): CreateKnowledgeDocumentInput {
  return {
    id: "kdoc_onboarding001",
    organizationId: "org_departify01",
    collectionId: "kcol_operations01",
    scope: "organization",
    title: "Customer Onboarding",
    contentType: "markdown",
    source: {
      id: "ksrc_manual001",
      type: "manual",
      name: "Operations Manual",
    },
    chunks: [
      {
        id: "kchk_onboarding001",
        documentId: "kdoc_onboarding001",
        sequence: 0,
        content: "Onboarding requires kickoff, verification, and follow up.",
        metadata: { section: "overview" },
      },
    ],
    tags: ["onboarding", "operations"],
    createdAt: new Date("2026-08-05T00:00:00.000Z"),
    ...overrides,
  };
}

export function documentSnapshot(
  overrides: Partial<KnowledgeDocumentSnapshot> = {},
): KnowledgeDocumentSnapshot {
  return {
    ...KnowledgeDocument.create(documentInput()).toSnapshot(),
    ...overrides,
  };
}

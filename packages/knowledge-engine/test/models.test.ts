import {
  KnowledgeCollection,
  KnowledgeDocument,
  KnowledgeEngineValidationError,
  knowledgeContentTypes,
  knowledgeScopes,
  knowledgeStatuses,
  type KnowledgeEngineEvent,
} from "../src/index.js";
import { documentInput } from "./fixtures.js";

describe("knowledge models", () => {
  it("declares scopes, statuses, and content types", () => {
    expect(knowledgeScopes).toEqual([
      "organization",
      "department",
      "agent",
      "workspace",
    ]);
    expect(knowledgeStatuses).toEqual([
      "draft",
      "active",
      "indexed",
      "archived",
      "deleted",
    ]);
    expect(knowledgeContentTypes).toEqual([
      "text",
      "markdown",
      "html",
      "json",
      "pdf",
    ]);
  });

  it("creates documents and emits creation events", () => {
    const document = KnowledgeDocument.create(documentInput());

    expect(document.toSnapshot()).toMatchObject({
      id: "kdoc_onboarding001",
      status: "draft",
      title: "Customer Onboarding",
    });
    expect(document.pullEvents()).toEqual<KnowledgeEngineEvent[]>([
      {
        type: "knowledge.created",
        documentId: "kdoc_onboarding001",
        collectionId: "kcol_operations01",
        sourceId: "ksrc_manual001",
        occurredAt: new Date("2026-08-05T00:00:00.000Z"),
      },
    ]);
  });

  it("supports controlled lifecycle transitions", () => {
    const document = KnowledgeDocument.create(documentInput());
    document.pullEvents();

    document.activate(new Date("2026-08-05T01:00:00.000Z"));
    document.markIndexed(
      "kidx_onboarding001",
      new Date("2026-08-05T02:00:00.000Z"),
    );
    document.archive(new Date("2026-08-05T03:00:00.000Z"));
    document.delete(new Date("2026-08-05T04:00:00.000Z"));

    expect(document.getStatus()).toBe("deleted");
    expect(document.pullEvents().map((event) => event.type)).toEqual([
      "knowledge.indexed",
      "knowledge.archived",
      "knowledge.deleted",
    ]);
  });

  it("validates chunks and collections", () => {
    expect(() =>
      KnowledgeDocument.create(
        documentInput({
          chunks: [
            {
              id: "kchk_bad001",
              documentId: "other_doc",
              sequence: 0,
              content: "Invalid chunk owner.",
              metadata: {},
            },
          ],
        }),
      ),
    ).toThrow(KnowledgeEngineValidationError);

    expect(
      KnowledgeCollection.create({
        id: "kcol_operations01",
        organizationId: "org_departify01",
        name: "Operations",
        scope: "organization",
      }).toSnapshot(),
    ).toMatchObject({ name: "Operations" });
  });
});

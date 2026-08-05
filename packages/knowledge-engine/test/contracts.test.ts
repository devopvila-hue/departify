import type {
  KnowledgeCollectionStore,
  KnowledgeDocumentStore,
  KnowledgeRetrievalPort,
} from "../src/index.js";
import { documentInput, documentSnapshot } from "./fixtures.js";

describe("knowledge contracts", () => {
  it("defines document store contracts without concrete storage", async () => {
    const store: KnowledgeDocumentStore = {
      async create(input) {
        return documentSnapshot(input);
      },
      async update(document) {
        return document;
      },
      async getById(id) {
        return documentSnapshot({ id });
      },
    };

    await expect(store.create(documentInput())).resolves.toMatchObject({
      id: "kdoc_onboarding001",
    });
  });

  it("defines collection store contracts without concrete storage", async () => {
    const store: KnowledgeCollectionStore = {
      async create(collection) {
        return collection;
      },
      async getById(id) {
        return {
          id,
          organizationId: "org_departify01",
          name: "Operations",
          scope: "organization",
        };
      },
    };

    await expect(store.getById("kcol_operations01")).resolves.toMatchObject({
      name: "Operations",
    });
  });

  it("defines retrieval contracts without searches", async () => {
    const port: KnowledgeRetrievalPort = {
      async retrieve(request) {
        return {
          documents: [
            documentSnapshot({
              organizationId: request.organizationId,
            }),
          ],
        };
      },
    };

    await expect(
      port.retrieve({
        organizationId: "org_departify01",
        query: "onboarding",
        selectionPolicy: {
          scopes: ["organization"],
          contentTypes: ["markdown"],
          includeArchived: false,
        },
        rankingPolicy: {
          signals: ["freshness"],
          requireDeterministicOrder: true,
        },
        limit: 1,
      }),
    ).resolves.toMatchObject({
      documents: [
        expect.objectContaining({ organizationId: "org_departify01" }),
      ],
    });
  });
});

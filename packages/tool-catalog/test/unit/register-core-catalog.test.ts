import type {
  MemoryRetrievalPort,
  MemoryRecordSnapshot,
  MemoryRetrievalResult,
} from "@departify/memory-engine";
import type {
  KnowledgeDocumentSnapshot,
  KnowledgeRetrievalPort,
  KnowledgeRetrievalResult,
} from "@departify/knowledge-engine";
import { Organization } from "@departify/organization-domain";
import {
  CORE_CATALOG_IDS,
  buildCoreCatalog,
  registerAllCoreTools,
  type CoreCatalogContext,
} from "../../src/index.js";

function buildOrganization(): Organization {
  return Organization.request({
    id: "org_departify",
    name: "Departify",
    brand: { displayName: "Departify" },
    license: { plan: "professional", seats: 10 },
    settings: {
      timeZone: "Europe/Madrid",
      locale: "es-ES",
      limits: {
        maxWorkspaces: 2,
        maxMembers: 10,
      },
      featureFlags: {
        foundation: true,
      },
      contactInformation: {
        email: "hello@departify.example",
        website: "https://departify.example",
      },
    },
    initialWorkspace: { id: "wsp_default", name: "Default" },
  });
}

class FakeRegistry {
  private readonly map = new Map<string, { id: string; version: string }>();
  register(definition: { id: string; version: string }): void {
    if (this.map.has(`${definition.id}@${definition.version}`)) {
      throw new Error("duplicate");
    }
    this.map.set(`${definition.id}@${definition.version}`, {
      id: definition.id,
      version: definition.version,
    });
  }
  has(id: string, version?: string): boolean {
    if (!version) {
      return [...this.map.values()].some((entry) => entry.id === id);
    }
    return this.map.has(`${id}@${version}`);
  }
  list(): { id: string; version: string }[] {
    return [...this.map.values()];
  }
}

describe("registerAllCoreTools", () => {
  it("is the single composition point and registers all 5 Tools by default", () => {
    const registry = new FakeRegistry();
    const organization = buildOrganization();
    const memoryPort: MemoryRetrievalPort = {
      retrieve: async (): Promise<MemoryRetrievalResult> => ({
        memories: [] as readonly MemoryRecordSnapshot[],
      }),
    };
    const knowledgePort: KnowledgeRetrievalPort = {
      retrieve: async (): Promise<KnowledgeRetrievalResult> => ({
        documents: [] as readonly KnowledgeDocumentSnapshot[],
      }),
    };

    const context: CoreCatalogContext = {
      organizationResolver: {
        resolve: () => ({ organization, snapshot: organization.toSnapshot() }),
      },
      memoryRetrieval: memoryPort,
      knowledgeRetrieval: knowledgePort,
    };

    const result = registerAllCoreTools(registry, context);

    expect(result.entries.map((entry) => entry.id).sort()).toEqual(
      [...CORE_CATALOG_IDS].sort(),
    );
    expect(result.skipped).toHaveLength(0);
    expect(registry.list().length).toBe(5);
  });

  it("skips Tools whose context is missing", () => {
    const registry = new FakeRegistry();
    const result = registerAllCoreTools(registry, {});

    const ids = result.entries.map((entry) => entry.id);
    expect(ids).toContain("system.uuid");
    expect(ids).toContain("system.health");
    expect(ids).not.toContain("organization.get");
    expect(ids).not.toContain("memory.search");
    expect(ids).not.toContain("knowledge.search");
  });

  it("skips duplicates when the same Tool is already registered", () => {
    const registry = new FakeRegistry();
    const result1 = registerAllCoreTools(registry, {});
    expect(result1.entries.length).toBeGreaterThan(0);

    const result2 = registerAllCoreTools(registry, {});
    expect(result2.entries).toHaveLength(0);
    expect(result2.skipped.length).toBe(result1.entries.length);
    expect(result2.skipped.every((s) => s.reason.includes("registered"))).toBe(
      true,
    );
  });

  it("buildCoreCatalog with empty context returns only the Tools that need no context", () => {
    const tools = buildCoreCatalog({});
    expect(tools.map((tool) => tool.id).sort()).toEqual([
      "system.health",
      "system.uuid",
    ]);
  });

  it("buildCoreCatalog with full context returns every Tool in CORE_CATALOG_IDS", () => {
    const organization = buildOrganization();
    const memoryPort: MemoryRetrievalPort = {
      retrieve: async (): Promise<MemoryRetrievalResult> => ({
        memories: [] as readonly MemoryRecordSnapshot[],
      }),
    };
    const knowledgePort: KnowledgeRetrievalPort = {
      retrieve: async (): Promise<KnowledgeRetrievalResult> => ({
        documents: [] as readonly KnowledgeDocumentSnapshot[],
      }),
    };

    const tools = buildCoreCatalog({
      organizationResolver: {
        resolve: () => ({ organization, snapshot: organization.toSnapshot() }),
      },
      memoryRetrieval: memoryPort,
      knowledgeRetrieval: knowledgePort,
    });

    expect(tools.map((tool) => tool.id).sort()).toEqual(
      [...CORE_CATALOG_IDS].sort(),
    );
  });
});

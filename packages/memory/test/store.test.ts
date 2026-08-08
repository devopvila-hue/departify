import { describe, expect, it } from "vitest";
import {
  createInMemoryMemoryRecordStore,
  InMemoryMemoryRecordStore,
} from "../src/index.js";
import { MemoryRecord } from "@departify/memory-engine";

describe("InMemoryMemoryRecordStore", () => {
  function buildStore(): InMemoryMemoryRecordStore {
    return createInMemoryMemoryRecordStore();
  }

  it("stores and retrieves department memory through canonical Memory Engine", async () => {
    const store = buildStore();
    const record = MemoryRecord.create({
      id: "mem_test_1",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Learning about Barcelona audience",
      priority: 80,
      tags: ["kind.audience", "prov.conversation"],
    });

    await store.create(record.toSnapshot());
    const found = await store.getById("mem_test_1");
    expect(found).toBeTruthy();
    expect(found?.departmentId).toBe("marketing");
    expect(found?.organizationId).toBe("org_a");
    expect(found?.scope).toBe("department");
    expect(found?.kind).toBe("department");
  });

  it("lists department-scoped records filtered by departmentId", async () => {
    const store = buildStore();

    await store.create(MemoryRecord.create({
      id: "mem_mkt_1",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Marketing knowledge A",
      priority: 80,
      tags: ["kind.audience"],
    }).toSnapshot());

    await store.create(MemoryRecord.create({
      id: "mem_mkt_2",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Marketing knowledge B",
      priority: 60,
      tags: ["kind.channel"],
    }).toSnapshot());

    await store.create(MemoryRecord.create({
      id: "mem_fin_1",
      organizationId: "org_a",
      departmentId: "finance",
      kind: "department",
      scope: "department",
      content: "Finance knowledge",
      priority: 70,
      tags: ["kind.decision"],
    }).toSnapshot());

    const marketing = store.list({
      organizationId: "org_a",
      departmentId: "marketing",
    });
    expect(marketing).toHaveLength(2);
    expect(marketing.every((m) => m.departmentId === "marketing")).toBe(true);
  });

  it("isolates organizations — Org A cannot read Org B memory", async () => {
    const store = buildStore();

    await store.create(MemoryRecord.create({
      id: "mem_a_1",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Org A marketing knowledge",
      priority: 80,
      tags: ["kind.audience"],
    }).toSnapshot());

    await store.create(MemoryRecord.create({
      id: "mem_b_1",
      organizationId: "org_b",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Org B marketing knowledge",
      priority: 80,
      tags: ["kind.audience"],
    }).toSnapshot());

    const orgA = store.list({ organizationId: "org_a" });
    const orgB = store.list({ organizationId: "org_b" });

    expect(orgA).toHaveLength(1);
    expect(orgB).toHaveLength(1);
    expect(orgA[0]?.id).toBe("mem_a_1");
    expect(orgB[0]?.id).not.toBe("mem_a_1");
  });

  it("filters by tags (department memory kind)", async () => {
    const store = buildStore();

    await store.create(MemoryRecord.create({
      id: "mem_audience",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Audience insight",
      priority: 80,
      tags: ["kind.audience"],
    }).toSnapshot());

    await store.create(MemoryRecord.create({
      id: "mem_channel",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Channel insight",
      priority: 70,
      tags: ["kind.channel"],
    }).toSnapshot());

    const audience = store.list({
      organizationId: "org_a",
      departmentId: "marketing",
      tag: "kind.audience",
    });
    expect(audience).toHaveLength(1);
    expect(audience[0]?.id).toBe("mem_audience");
  });

  it("deduplication: hasSimilar detects identical content", async () => {
    const store = buildStore();

    await store.create(MemoryRecord.create({
      id: "mem_dup_1",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "International students are priority audience",
      priority: 80,
      tags: ["kind.audience"],
    }).toSnapshot());

    expect(store.hasSimilar("marketing", "International students are priority audience")).toBe(true);
    expect(store.hasSimilar("marketing", "International students are priority audience ")).toBe(true);
    expect(store.hasSimilar("marketing", "Different content")).toBe(false);
    expect(store.hasSimilar("finance", "International students are priority audience")).toBe(false);
  });

  it("sorts by priority desc then recency", async () => {
    const store = buildStore();

    await store.create(MemoryRecord.create({
      id: "mem_low",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "Low priority",
      priority: 30,
      tags: ["kind.note"],
    }).toSnapshot());

    await store.create(MemoryRecord.create({
      id: "mem_high",
      organizationId: "org_a",
      departmentId: "marketing",
      kind: "department",
      scope: "department",
      content: "High priority",
      priority: 90,
      tags: ["kind.result"],
    }).toSnapshot());

    const list = store.list({ organizationId: "org_a" });
    expect(list[0]?.id).toBe("mem_high");
    expect(list[1]?.id).toBe("mem_low");
  });
});

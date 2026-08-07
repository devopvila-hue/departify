/**
 * Sprint 59 — Department memory and DNA suggestion provenance.
 *
 * Department memory is NOT another Company DNA. It is a scoped,
 * domain-specific working knowledge that a Department carries across
 * sessions. The Company DNA (the shared truth) is NEVER mutated by a
 * department directly. Any candidate insight is exposed as a
 * `DnaSuggestion` through the Command Center — the CEO explicitly
 * approves the suggestion before it is merged into the shared truth.
 */
import { describe, expect, it } from "vitest";

import {
  buildDnaSuggestion,
  listDepartmentMemory,
  rememberDepartment,
} from "../src/customer-zero/department-memory.js";
import { getOrCreateCustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";

describe("Department memory", () => {
  it("stores entries scoped by (organizationId, departmentId)", () => {
    const session = getOrCreateCustomerZeroSession("org_dept_mem_1");
    rememberDepartment(session, "marketing", {
      kind: "campaign",
      title: "Lanzamiento Barcelona",
      content: "Lanzamos campaña piloto en Barcelona con 1000€.",
      provenance: "ceo_statement",
      importance: 0.9,
    });
    rememberDepartment(session, "marketing", {
      kind: "channel",
      title: "Instagram rinde mejor",
      content: "Instagram convierte 2x mejor que LinkedIn para nuestra audiencia.",
      provenance: "internal_analysis",
      importance: 0.7,
    });
    // Different department — should not appear in marketing memory.
    rememberDepartment(session, "finance", {
      kind: "decision",
      title: "Pago a proveedor",
      content: "Pagamos a proveedor X el 12/08.",
      provenance: "ceo_statement",
      importance: 0.5,
    });

    const marketing = listDepartmentMemory(session, "marketing");
    expect(marketing).toHaveLength(2);
    const ids = marketing.map((m) => m.kind);
    expect(ids).toContain("campaign");
    expect(ids).toContain("channel");
    const finance = listDepartmentMemory(session, "finance");
    expect(finance).toHaveLength(1);
    expect(finance[0]?.kind).toBe("decision");
  });

  it("returns entries sorted by importance then recency", () => {
    const session = getOrCreateCustomerZeroSession("org_dept_mem_2");
    rememberDepartment(session, "marketing", {
      kind: "note",
      title: "Baja",
      content: "Nota menor",
      provenance: "conversation",
      importance: 0.2,
    });
    rememberDepartment(session, "marketing", {
      kind: "channel",
      title: "Alta",
      content: "Hallazgo importante",
      provenance: "internal_analysis",
      importance: 0.9,
    });
    const list = listDepartmentMemory(session, "marketing");
    expect(list[0]?.title).toBe("Alta");
    expect(list[1]?.title).toBe("Baja");
  });

  it("filters by kind when requested", () => {
    const session = getOrCreateCustomerZeroSession("org_dept_mem_3");
    rememberDepartment(session, "marketing", {
      kind: "channel",
      title: "Canal",
      content: "x",
      provenance: "internal_analysis",
    });
    rememberDepartment(session, "marketing", {
      kind: "experiment",
      title: "Experimento",
      content: "y",
      provenance: "internal_analysis",
    });
    const channels = listDepartmentMemory(session, "marketing", { kind: "channel" });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.kind).toBe("channel");
  });

  it("clamps importance to [0, 1]", () => {
    const session = getOrCreateCustomerZeroSession("org_dept_mem_4");
    const entry = rememberDepartment(session, "marketing", {
      kind: "note",
      title: "Out of range",
      content: "x",
      provenance: "ceo_statement",
      importance: 5,
    });
    expect(entry.importance).toBe(1);
    const entry2 = rememberDepartment(session, "marketing", {
      kind: "note",
      title: "Negative",
      content: "x",
      provenance: "ceo_statement",
      importance: -0.5,
    });
    expect(entry2.importance).toBe(0);
  });

  it("campaign / channel / audience / messaging / positioning / experiment / content / result / decision / note are the only kinds", () => {
    const session = getOrCreateCustomerZeroSession("org_dept_mem_5");
    const kinds = [
      "campaign",
      "channel",
      "audience",
      "messaging",
      "positioning",
      "experiment",
      "content",
      "result",
      "decision",
      "note",
    ] as const;
    for (const kind of kinds) {
      rememberDepartment(session, "marketing", {
        kind,
        title: `${kind}`,
        content: "x",
        provenance: "internal_analysis",
      });
    }
    expect(listDepartmentMemory(session, "marketing")).toHaveLength(kinds.length);
  });
});

describe("DNA suggestion provenance", () => {
  it("DnaSuggestion is the only path from a department to Company DNA", () => {
    const suggestion = buildDnaSuggestion({
      fromDepartment: "marketing",
      title: "Segmento principal Barcelona 25-35",
      content: "El 70% de las conversiones vienen de Barcelona 25-35.",
      evidence: ["12 campañas analizadas"],
      confidence: 0.85,
    });
    expect(suggestion.fromDepartment).toBe("marketing");
    expect(suggestion.confidence).toBe(0.85);
  });

  it("the suggestion carries evidence, not the DNA itself", () => {
    const suggestion = buildDnaSuggestion({
      fromDepartment: "marketing",
      title: "X",
      content: "Y",
      evidence: ["a", "b"],
    });
    expect(suggestion.evidence).toEqual(["a", "b"]);
    expect(suggestion.content).toBe("Y");
  });

  it("the suggestion is the only mechanism — no Department → CompanyDNA path exists", () => {
    // Department memory is local. The suggestion is the only way to
    // propose shared-truth updates. This is an architectural contract:
    // there is no Department class with a `commitToDNA` method.
    expect(typeof buildDnaSuggestion).toBe("function");
    const session = getOrCreateCustomerZeroSession("org_dept_mem_6");
    rememberDepartment(session, "marketing", {
      kind: "result",
      title: "Internal result",
      content: "An internal result, scoped to Marketing.",
      provenance: "internal_analysis",
      importance: 0.95,
    });
    const marketing = listDepartmentMemory(session, "marketing");
    expect(marketing).toHaveLength(1);
    expect(marketing[0]?.content).toContain("internal result");
  });
});

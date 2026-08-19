/**
 * Sprint 67 P0.1-B — Next Best Actions tests (N1–N10).
 *
 *   N1 resultado SEO        → acciones SEO contextuales
 *   N2 resultado Marketing  → acciones Marketing contextuales
 *   N3 máximo 3
 *   N4 capability inexistente → no aparece
 *   N5 conexión requerida   → ofrece "Conectar X"
 *   N6 approval requerido   → conserva approval gate
 *   N7 saludo simple        → no fuerza sugerencias
 *   N8 click suggestion     → usa command/chat path existente
 *      (backend half: `request` es texto de chat real; portal half
 *      lives in the portal test suite)
 *   N9 no duplica DepartmentTask  (ids únicos, sin duplicados)
 *   N10 no duplica assistant result (state in → actions out, sin eco)
 */

import { describe, expect, it } from "vitest";
import {
  resolveNextBestActions,
  type NextBestActionsInput,
} from "../src/customer-zero/next-best-actions.js";
import type { DepartmentResult } from "../src/customer-zero/department-work.js";

function seoResult(): DepartmentResult {
  return {
    id: "res_seo_1",
    organizationId: "org_nba",
    departmentId: "seo",
    relatedWorkItemId: null,
    title: "Auditoría SEO de departify.app",
    summary: "12 problemas priorizados.",
    content: "",
    source: "seo",
    createdAt: "2026-08-19T12:00:00.000Z",
    producedByCapability: "seo.audit.website",
  };
}

function marketingResult(): DepartmentResult {
  return {
    id: "res_mkt_1",
    organizationId: "org_nba",
    departmentId: "marketing",
    relatedWorkItemId: null,
    title: "Estrategia de contenidos",
    summary: "Estrategia trimestral lista.",
    content: "",
    source: "marketing",
    createdAt: "2026-08-19T12:00:00.000Z",
    producedByCapability: "marketing.wordpress.connection.test",
  };
}

function input(overrides?: Partial<NextBestActionsInput>): NextBestActionsInput {
  return {
    locale: "es",
    intent: "delegate_seo",
    results: [],
    approvals: [],
    connections: [],
    connectionSuggestion: null,
    ...overrides,
  };
}

describe("P0.1-B — Next Best Actions resolver (N1–N10)", () => {
  it("N1: SEO audit result yields contextual SEO actions", () => {
    const actions = resolveNextBestActions(
      input({ results: [seoResult()], intent: "delegate_seo" }),
    );
    const labels = actions.map((action) => action.label);
    expect(labels).toContain("Corregir problemas prioritarios");
    expect(labels).toContain("Preparar plan SEO");
    // Without a connected repository the third SEO action must NOT appear.
    expect(labels).not.toContain("Revisar repositorio");
    for (const action of actions) {
      expect(action.classification).toBe("AVAILABLE_NOW");
      expect(action.request.length).toBeGreaterThan(10);
    }
  });

  it("N1b: with a connected repository, 'Revisar repositorio' appears", () => {
    const actions = resolveNextBestActions(
      input({
        results: [seoResult()],
        connections: [{ toolId: "github_repository", label: "GitHub", status: "connected" }],
      }),
    );
    expect(actions.map((a) => a.label)).toContain("Revisar repositorio");
  });

  it("N2: Marketing result yields Marketing actions; publishing needs the connection", () => {
    const disconnected = resolveNextBestActions(
      input({ results: [marketingResult()], intent: "delegate_marketing" }),
    );
    const labels = disconnected.map((a) => a.label);
    expect(labels).toContain("Convertir estrategia en tareas");
    expect(labels).toContain("Preparar calendario");
    // Not connected → the honest action is connecting, not publishing.
    expect(labels).toContain("Conectar Facebook");
    expect(labels).not.toContain("Crear primera publicación");

    const connected = resolveNextBestActions(
      input({
        results: [marketingResult()],
        connections: [{ toolId: "meta_business", label: "Meta Business", status: "connected" }],
      }),
    );
    expect(connected.map((a) => a.label)).toContain("Crear primera publicación");
    expect(connected.map((a) => a.label)).not.toContain("Conectar Facebook");
  });

  it("N3: never more than 3 actions", () => {
    const actions = resolveNextBestActions(
      input({
        results: [seoResult()],
        approvals: [
          {
            id: "apr_1",
            departmentId: "marketing",
            from: "Elvira",
            title: "Publicar en Facebook",
            detail: "Publicación lista",
            status: "pending",
            createdAt: "2026-08-19T12:00:00.000Z",
          },
        ],
        connections: [{ toolId: "github_repository", label: "GitHub", status: "connected" }],
        connectionSuggestion: { toolId: "google_analytics", label: "Google Analytics" },
      }),
    );
    expect(actions.length).toBe(3);
  });

  it("N4: an action whose capability does not exist never appears", () => {
    const actions = resolveNextBestActions(
      input({ results: [seoResult()], connections: [] }),
    );
    expect(actions.map((a) => a.label)).not.toContain("Revisar repositorio");
    expect(actions.map((a) => a.id)).not.toContain("seo_review_repository");
  });

  it("N5: a needed-but-missing connection offers 'Conectar X', never 'Analizar X'", () => {
    const actions = resolveNextBestActions(
      input({
        intent: "external_tool_query",
        results: [],
        connectionSuggestion: { toolId: "google_analytics", label: "Google Analytics" },
      }),
    );
    expect(actions.length).toBe(1);
    expect(actions[0]?.label).toBe("Conectar Google Analytics");
    expect(actions[0]?.classification).toBe("NEEDS_CONNECTION");
    for (const action of actions) {
      expect(action.label).not.toMatch(/^Analizar/);
      expect(action.request).not.toMatch(/analiza/i);
    }
  });

  it("N5b: no connection suggestion when the tool is already connected", () => {
    const actions = resolveNextBestActions(
      input({
        connectionSuggestion: { toolId: "google_analytics", label: "Google Analytics" },
        connections: [{ toolId: "google_analytics", label: "Google Analytics", status: "connected" }],
      }),
    );
    expect(actions.length).toBe(0);
  });

  it("N6: a pending approval surfaces first and keeps the gate", () => {
    const actions = resolveNextBestActions(
      input({
        results: [marketingResult()],
        approvals: [
          {
            id: "apr_1",
            departmentId: "marketing",
            from: "Elvira",
            title: "Publicar en Facebook",
            detail: "Publicación lista",
            status: "pending",
            createdAt: "2026-08-19T12:00:00.000Z",
          },
        ],
      }),
    );
    expect(actions[0]?.id).toBe("review_approval");
    expect(actions[0]?.classification).toBe("NEEDS_APPROVAL");
    // The request SHOWS the approval for the CEO to decide — it never
    // approves by itself.
    expect(actions[0]?.request).toMatch(/aprobaci[oó]n pendiente/i);
    expect(actions[0]?.request).not.toMatch(/aprueba|aprobar/i);
  });

  it("N7: a simple greeting yields no actions", () => {
    expect(
      resolveNextBestActions(input({ intent: "direct_response" })),
    ).toEqual([]);
    // Even with a turn intent present, no durable work + no approvals +
    // no connection need → nothing to suggest.
    expect(resolveNextBestActions(input({ intent: "delegate_marketing" }))).toEqual([]);
    // No generic filler is ever produced.
    const filler = ["Explorar más", "Seguir trabajando", "Analizar resultados"];
    const actions = resolveNextBestActions(
      input({ results: [seoResult()], intent: "direct_response" }),
    );
    for (const action of actions) {
      expect(filler).not.toContain(action.label);
    }
  });

  it("N8: every request is real chat text for the existing path (backend half)", () => {
    const cases = [
      input({ results: [seoResult()] }),
      input({ results: [marketingResult()] }),
      input({
        approvals: [
          {
            id: "apr_1",
            departmentId: "marketing",
            from: "Elvira",
            title: "X",
            detail: "Y",
            status: "pending",
            createdAt: "2026-08-19T12:00:00.000Z",
          },
        ],
      }),
    ];
    for (const testCase of cases) {
      for (const action of resolveNextBestActions(testCase)) {
        expect(typeof action.request).toBe("string");
        expect(action.request.trim().length).toBeGreaterThan(5);
        // No protocol/internal vocabulary leaks into the button request.
        expect(action.request).not.toMatch(/departify\.|tool_call|capability/i);
      }
    }
  });

  it("N9/N10: ids are unique and the resolver never echoes state back as work", () => {
    const actions = resolveNextBestActions(
      input({
        results: [seoResult(), marketingResult()],
        connections: [{ toolId: "github_repository", label: "GitHub", status: "connected" }],
        connectionSuggestion: { toolId: "mautic", label: "Mautic" },
      }),
    );
    const ids = actions.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(actions.length).toBeLessThanOrEqual(3);
    // Deterministic: same input, same output (no duplicated tasks/results).
    const again = resolveNextBestActions(
      input({
        results: [seoResult(), marketingResult()],
        connections: [{ toolId: "github_repository", label: "GitHub", status: "connected" }],
        connectionSuggestion: { toolId: "mautic", label: "Mautic" },
      }),
    );
    expect(again).toEqual(actions);
  });

  it("uses the NEWEST result only (a fresh SEO result replaces old marketing suggestions)", () => {
    const older = { ...marketingResult(), createdAt: "2026-08-18T12:00:00.000Z" };
    const actions = resolveNextBestActions(
      input({ results: [seoResult(), older] }),
    );
    expect(actions.some((action) => action.id.startsWith("seo_"))).toBe(true);
    expect(actions.some((action) => action.id.startsWith("marketing_"))).toBe(false);
  });
});

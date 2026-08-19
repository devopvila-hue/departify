/**
 * Sprint 67 P0.1-A — Personal identity tests (I1–I6).
 *
 *   I1 usuario con nombre existente        → no pregunta nombre
 *   I2 usuario sin nombre                  → puede preguntar una vez
 *   I3 nombre guardado                     → persistencia server-side
 *   I4 reload/nueva conversación           → no vuelve a preguntar
 *   I5 nunca usa CEO como vocativo
 *   I6 petición empresarial sin nombre     → ejecuta trabajo, no bloquea
 *
 * The persistence proof uses the real in-memory CompanyDnaStore (the
 * same contract Supabase implements), so the tests exercise the same
 * read-modify-write production runs.
 */

import { describe, expect, it } from "vitest";
import {
  InMemoryCompanyDnaStore,
  isConfirmationCurrent,
  type CompanyDnaRecord,
} from "../src/customer-zero/company-dna.js";
import {
  entrepreneurNameAlreadyRequested,
  extractEntrepreneurNameFromAnswer,
  extractEntrepreneurNameIntroduction,
  hydrateSessionPreferredName,
  markEntrepreneurNameRequested,
  normalizePreferredName,
  persistEntrepreneurPreferredName,
  resolveEntrepreneurPreferredName,
} from "../src/customer-zero/personal-identity.js";
import { getOrCreateCustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";
import {
  compileRuntimeBusinessContext,
} from "../src/customer-zero/department-context-compiler.js";
import { buildRuntimeCapabilityManifest } from "../src/customer-zero/capability-manifest.js";
import { renderOpenClawTurn } from "@departify/engine-adapter";

function record(overrides?: Partial<CompanyDnaRecord>): CompanyDnaRecord {
  return {
    organizationId: "org_identity",
    companyName: "Taller Norte",
    description: "Ebanistería artesanal.",
    country: "España",
    objective: "Duplicar pedidos online.",
    products: ["Mesas a medida"],
    customers: ["Estudios de arquitectura"],
    channels: ["Web"],
    declaredTools: [],
    uncertainties: [],
    provenance: {},
    factsUpdatedAt: "2026-08-10T10:00:00.000Z",
    ceoConfirmedAt: "2026-08-10T11:00:00.000Z",
    ...overrides,
  };
}

function compileFor(org: string, dna: CompanyDnaRecord | null) {
  const session = getOrCreateCustomerZeroSession(org, { locale: "es" });
  return compileRuntimeBusinessContext({
    session,
    companyDna: dna,
    capabilities: buildRuntimeCapabilityManifest([]),
    connections: [],
    tasks: [],
    results: [],
    approvals: [],
    recentConversation: [],
  });
}

describe("P0.1-A — Personal identity (I1–I6)", () => {
  it("I1: a known name reaches the runtime context and blocks the question (no re-ask)", () => {
    const dna = record({ entrepreneurPreferredName: "Marta" });
    const context = compileFor("org_i1", dna);
    expect(context.identity.userPreferredName).toBe("Marta");
    expect(context.identity.userNameRequested).toBe(false);
    // A known name means there is nothing to ask — the ask-once guard is
    // irrelevant because the name exists. The engine prompt must use it
    // sparingly and never as a title.
    const turn = renderOpenClawTurn({
      sessionId: "s",
      message: "hola",
      runtimeContext: JSON.stringify(context.identity),
      nativeBusinessTools: true,
    });
    expect(turn).toContain("userPreferredName");
    expect(turn).toContain("Marta");
  });

  it("I2: without a name the context allows exactly one ask (userNameRequested=false → true)", async () => {
    const store = new InMemoryCompanyDnaStore();
    await store.upsert(record());
    expect(entrepreneurNameAlreadyRequested(await store.get("org_identity"))).toBe(false);
    await markEntrepreneurNameRequested(store, "org_identity", "2026-08-19T10:00:00.000Z");
    const updated = await store.get("org_identity");
    expect(updated?.entrepreneurNameRequestedAt).toBe("2026-08-19T10:00:00.000Z");
    expect(entrepreneurNameAlreadyRequested(updated)).toBe(true);
    // Marking twice is idempotent (still exactly one ask).
    await markEntrepreneurNameRequested(store, "org_identity", "2026-08-19T12:00:00.000Z");
    expect((await store.get("org_identity"))?.entrepreneurNameRequestedAt).toBe(
      "2026-08-19T10:00:00.000Z",
    );
    const context = compileFor("org_i2", updated);
    expect(context.identity.userPreferredName).toBeNull();
    expect(context.identity.userNameRequested).toBe(true);
  });

  it("I3: a captured name persists server-side in the DNA record (work facts untouched)", async () => {
    const store = new InMemoryCompanyDnaStore();
    await store.upsert(record());
    const updated = await persistEntrepreneurPreferredName(
      store,
      "org_identity",
      "  Marta   López ",
    );
    expect(updated?.entrepreneurPreferredName).toBe("Marta López");
    // Durable read-back — not memory, not the browser.
    expect((await store.get("org_identity"))?.entrepreneurPreferredName).toBe("Marta López");
    // The name is NOT a business fact: the CEO confirmation stays valid.
    expect(updated?.factsUpdatedAt).toBe("2026-08-10T10:00:00.000Z");
    expect(isConfirmationCurrent(updated ?? null)).toBe(true);
  });

  it("I4: after reload the hydrated session keeps the name and never asks again", async () => {
    const store = new InMemoryCompanyDnaStore();
    await store.upsert(
      record({
        entrepreneurPreferredName: "Marta",
        entrepreneurNameRequestedAt: "2026-08-19T10:00:00.000Z",
      }),
    );
    // A brand-new session (simulated restart) hydrates from durable DNA.
    const session = getOrCreateCustomerZeroSession("org_i4", { locale: "es" });
    const durable = await store.get("org_identity");
    hydrateSessionPreferredName(session, durable);
    expect(session.state.entrepreneurPreferredName).toBe("Marta");
    const context = compileFor("org_i4", durable);
    expect(context.identity.userPreferredName).toBe("Marta");
    // Resolution priority: the durable record wins over an emptier session.
    expect(resolveEntrepreneurPreferredName(durable, session)).toBe("Marta");
  });

  it("I5: the engine prompt never addresses the user as CEO/jefe/estimado/apreciado", () => {
    const turn = renderOpenClawTurn({
      sessionId: "s",
      message: "hola",
      runtimeContext: "{}",
      nativeBusinessTools: true,
    });
    expect(turn).toContain("NEVER address the user as 'CEO'");
    expect(turn).toContain("never ask when identity.userNameRequested is true");
    expect(turn).toContain("Work always comes first");
  });

  it("I6: a business request without a known name is never misread as a name and never blocks", () => {
    // The extractor returns null for work requests — the turn proceeds.
    expect(extractEntrepreneurNameIntroduction("Audita el SEO de departify.app")).toBeNull();
    expect(extractEntrepreneurNameIntroduction("prepara una campaña de marketing")).toBeNull();
    // Even as a direct answer to the name question, a business request
    // is work, not a name.
    expect(
      extractEntrepreneurNameFromAnswer(
        "Audita el SEO de departify.app",
        "Antes de seguir, ¿cómo quieres que te llame?",
      ),
    ).toBeNull();
    // And a nameless context still compiles (the golden rule: work > profile).
    const context = compileFor("org_i6", record());
    expect(context.identity.userPreferredName).toBeNull();
    expect(context.company.name).toBe("Taller Norte");
  });

  it("captures explicit introductions and bare answers (the two real shapes)", () => {
    expect(extractEntrepreneurNameIntroduction("me llamo Marta")).toBe("Marta");
    expect(extractEntrepreneurNameIntroduction("Puedes llamarme Javi, gracias")).toBe("Javi");
    expect(extractEntrepreneurNameIntroduction("soy Lucía Ruiz")).toBe("Lucía Ruiz");
    expect(extractEntrepreneurNameIntroduction("mi nombre es Andrés")).toBe("Andrés");
    expect(extractEntrepreneurNameIntroduction("hola, qué tal")).toBeNull();
    // Bare answer — only valid right after the canonical question.
    expect(
      extractEntrepreneurNameFromAnswer("Marta", "¿cómo quieres que te llame?"),
    ).toBe("Marta");
    // Without the question, a bare word is never trusted.
    expect(extractEntrepreneurNameFromAnswer("Marta", "Tu SEO está listo.")).toBeNull();
    // Rejections: digits, emails, URLs, too long.
    expect(normalizePreferredName("Marta2020")).toBeNull();
    expect(normalizePreferredName("marta@correo.com")).toBeNull();
    expect(normalizePreferredName("https://departify.app")).toBeNull();
    expect(normalizePreferredName("Marta y audita mi web completa a fondo")).toBeNull();
  });
});

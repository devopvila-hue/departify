/**
 * Customer Zero 08 — onboarding / readiness PRODUCTION recovery.
 *
 * Reproduces the three production regressions:
 *
 *   A. Existing org without DNA must NOT render the legacy terminal
 *      handoff ("Ya tengo suficiente / Vamos a trabajar").
 *   B. The dead handoff transition is removed from the API.
 *   C. Understanding reconstruction fails honestly (never a dead end).
 *   D. New-user research failure never exposes raw "fetch failed" and
 *      never resets the intake.
 *
 * Plus the canonical-state-machine invariants:
 *   F. Confirm → refresh → chat.
 *   G. Backend restart after confirmation → chat.
 *   J. No route to chat with contextReady=false.
 *   K. Legacy "Ya tengo suficiente" cannot be a readiness bypass.
 *   L. A Company DNA row alone does not imply readiness.
 *   M. Stale confirmation after changed facts returns to review.
 *   N. Existing-org adoption never creates a replacement org.
 *
 * NOTE: the auth boundary requires real membership, so the fixture org
 * `org-a` (owner: user-a) is used directly and the durable Company DNA
 * store is seeded for the exact scenario under test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import {
  InMemoryCompanyDnaStore,
  type CompanyDnaRecord,
} from "../src/customer-zero/company-dna.js";
import {
  applyCeoConfirmation,
  durableOnboardingStage,
  markMilestone,
  projectIntakeToDna,
  projectResearchToDna,
  readinessFactsFromRecord,
  type OnboardingStage,
} from "../src/customer-zero/company-readiness.js";
import {
  installCorporateEmailStore,
  createInMemoryCorporateEmailStore,
} from "../src/customer-zero/corporate-email-store.js";
import {
  installGoogleTokenStore,
  createInMemoryGoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";
import { installGoogleOAuthStateStore } from "../src/customer-zero/oauth-state.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";
import { resetGoogleOperationalCacheForTest } from "../src/server/routes/customer-zero-v2.js";

const AUTH = { authorization: "Bearer token-a" };
const ORG = "org-a";

/** Drive a company to a fully ready durable state. */
async function onboardToReady(
  store: InMemoryCompanyDnaStore,
  organizationId: string,
): Promise<CompanyDnaRecord> {
  const t0 = new Date(Date.now() - 10_000).toISOString();
  await store.upsert(
    projectIntakeToDna(
      organizationId,
      {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      },
      t0,
      null,
    ),
  );
  const afterIntake = await store.get(organizationId);
  const t1 = new Date(Date.now() - 9_000).toISOString();
  await store.upsert(
    projectResearchToDna(afterIntake!, {
      products: ["Habitaciones compartidas"],
      targetAudience: ["Estudiantes"],
      locations: ["Barcelona"],
    }, t1),
  );
  await markMilestone(organizationId, store, "blockingDiscoveryCompletedAt", t1);
  const researchDone = await store.get(organizationId);
  const confirmed = applyCeoConfirmation(
    researchDone!,
    {},
    new Date(Date.now() - 8_000).toISOString(),
  );
  await store.upsert(confirmed);
  await markMilestone(
    organizationId,
    store,
    "departmentProvisionedAt",
    new Date(Date.now() - 7_000).toISOString(),
  );
  return (await store.get(organizationId))!;
}

describe("CZ08 — onboarding/readiness recovery", () => {
  let server: FastifyInstance;
  let dnaStore: InMemoryCompanyDnaStore;

  beforeEach(async () => {
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      companyDna: (dnaStore = new InMemoryCompanyDnaStore()),
    });
    installGoogleTokenStore(createInMemoryGoogleTokenStore());
    installGoogleOAuthStateStore(null);
    installCorporateEmailStore(createInMemoryCorporateEmailStore());
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    resetGoogleOperationalCacheForTest();
    installGoogleTokenStore(null);
    installGoogleOAuthStateStore(null);
    installCorporateEmailStore(null);
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.PUBLIC_BASE_URL;
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });
  }

  it("L: a Company DNA row alone does NOT imply readiness (stage research, not ready)", async () => {
    // Intake only, research never completed.
    await dnaStore.upsert(
      projectIntakeToDna(ORG, {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      }, new Date().toISOString(), null),
    );
    const status = await authedInject({ method: "GET", url: `/api/customer-zero/${ORG}` });
    expect(status.statusCode).toBe(200);
    const body = status.json();
    expect(body.contextReady).toBe(false);
    expect(body.stage).toBe("research");
  });

  it("A/K: existing org without DNA → stage intake; nextQuestion NEVER returns the legacy handoff", async () => {
    const status = await authedInject({ method: "GET", url: `/api/customer-zero/${ORG}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().stage).toBe("intake");
    const next = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${ORG}/next-question`,
    });
    expect(next.statusCode).toBe(200);
    const serialized = JSON.stringify(next.json());
    // The legacy terminal is GONE from the API — no readiness bypass.
    expect(serialized).not.toContain("Ya tengo suficiente");
    expect(serialized).not.toContain('"handoff"');
  });

  it("E: refresh during understanding review reconstructs stage 'understanding'", async () => {
    await onboardToReady(dnaStore, ORG);
    // Invalidate the confirmation by touching facts AFTER it.
    const record = await dnaStore.get(ORG);
    await dnaStore.upsert({
      ...record!,
      factsUpdatedAt: new Date(Date.now() + 1000).toISOString(),
    });
    const status = await authedInject({ method: "GET", url: `/api/customer-zero/${ORG}` });
    const body = status.json();
    expect(body.contextReady).toBe(false);
    expect(body.stage).toBe("understanding");
  });

  it("F/G: confirm → restart → status ready → the portal may enter chat", async () => {
    await onboardToReady(dnaStore, ORG);
    // Simulate a backend restart: the in-memory session is destroyed.
    resetCustomerZeroSessionsForTest();
    const status = await authedInject({ method: "GET", url: `/api/customer-zero/${ORG}` });
    const body = status.json();
    expect(body.contextReady).toBe(true);
    expect(body.stage).toBe("ready");
  });

  it("M: stale confirmation after changed facts returns to review", async () => {
    await onboardToReady(dnaStore, ORG);
    // New facts after confirmation → confirmation no longer current.
    const record = await dnaStore.get(ORG);
    await dnaStore.upsert({
      ...record!,
      factsUpdatedAt: new Date(Date.now() + 5000).toISOString(),
    });
    const fresh = await dnaStore.get(ORG);
    const facts = readinessFactsFromRecord(fresh);
    expect(facts.ceoConfirmed).toBe(false);
    const stage: OnboardingStage = durableOnboardingStage(fresh, facts);
    expect(stage).toBe("understanding");
  });

  it("J: a not-ready org is never contextReady (no chat bypass)", async () => {
    // Intake only — research incomplete.
    await dnaStore.upsert(
      projectIntakeToDna(ORG, {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      }, new Date().toISOString(), null),
    );
    const status = await authedInject({ method: "GET", url: `/api/customer-zero/${ORG}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().contextReady).toBe(false);
  });

  it("N: resume research reuses the SAME organization (never a replacement org)", async () => {
    await dnaStore.upsert(
      projectIntakeToDna(ORG, {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      }, new Date().toISOString(), null),
    );
    const resume = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${ORG}/research`,
    });
    expect(resume.statusCode).toBe(200);
    expect(resume.json().organizationId).toBe(ORG);
    // The org id survives — the durable record still belongs to ORG.
    const record = await dnaStore.get(ORG);
    expect(record?.organizationId).toBe(ORG);
  });

  it("C: understanding for an org with no DNA fails honestly (no dead end)", async () => {
    const understanding = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${ORG}/understanding`,
    });
    // 404 with a business message — the portal stays on a truthful
    // resumable state (intake/research), never a stranded screen.
    expect(understanding.statusCode).toBe(404);
  });

  it("D/I: research failure surfaces a business message, never raw 'fetch failed'", async () => {
    const { fetchAndExtractWebsite } = await import(
      "../src/customer-zero/web-analysis.js"
    );
    // A URL that cannot be reached → the fetch itself rejects; the
    // message must be business-readable, never the raw Node error.
    await expect(
      fetchAndExtractWebsite("https://nonexistent.invalid.departify.test"),
    ).rejects.toThrow(/no hemos podido acceder|comprueba la dirección|no tengo web/i);
  });
});

/**
 * P0 — Connection identity contract (Customer Zero /conexiones).
 *
 * Locks in:
 *   A. Every known ConnectionCard has non-empty name.
 *   B. Every known ConnectionCard has non-empty category/domain.
 *   C. Every known ConnectionCard has an intentional logo/brand identity.
 *   D. Gmail renders complete identity.
 *   E. Google Calendar renders complete identity.
 *   F. Google Drive renders complete identity.
 *   G. Resend is categorized as email, never CRM.
 *   H. Mautic remains connected/configured exactly as before.
 *   I. A genuinely unknown declared tool gets the intentional unknown representation.
 *   J. No known tool can produce logoMark === "?" or name === "—".
 *   K. (Backend portion) Backend exposes canonical categoryId so the portal
 *      can group without maintaining a duplicate tool-to-domain map.
 */

import { describe, expect, it } from "vitest";

import {
  CONNECTION_DEFINITIONS,
  getConnectionDefinition,
  renderConnectionCard,
} from "../src/customer-zero/connections-domain.js";

describe("Connection identity contract — every known card", () => {
  it("A. every entry has a non-empty name", () => {
    for (const def of CONNECTION_DEFINITIONS) {
      expect(def.name, `name for ${def.id}`).toBeTruthy();
      expect(def.name.length, `name for ${def.id}`).toBeGreaterThan(0);
    }
  });

  it("B. every entry has a non-empty category (es + en)", () => {
    for (const def of CONNECTION_DEFINITIONS) {
      expect(def.categoryEs, `categoryEs for ${def.id}`).toBeTruthy();
      expect(def.categoryEn, `categoryEn for ${def.id}`).toBeTruthy();
    }
  });

  it("C. every entry has a non-empty logoMark + brandColor", () => {
    for (const def of CONNECTION_DEFINITIONS) {
      expect(def.logoMark, `logoMark for ${def.id}`).toBeTruthy();
      expect(def.brandColor, `brandColor for ${def.id}`).toMatch(/^#[0-9a-fA-F]{3,6}$/);
    }
  });

  it("J. NO known entry produces logoMark '?' or name '—'", () => {
    for (const def of CONNECTION_DEFINITIONS) {
      expect(def.logoMark, `logoMark for ${def.id}`).not.toBe("?");
      expect(def.name, `name for ${def.id}`).not.toBe("—");
    }
  });
});

describe("Connection identity contract — Customer Zero tools", () => {
  it("D. Gmail renders complete identity", () => {
    const def = getConnectionDefinition("gmail");
    expect(def).not.toBeNull();
    expect(def!.name).toBe("Gmail");
    expect(def!.category).toBe("email");
    expect(def!.logoMark).toBeTruthy();
    expect(def!.capabilities.length).toBeGreaterThan(0);
    const card = renderConnectionCard(
      {
        organizationId: "org_x",
        toolId: "gmail",
        label: "Gmail",
        declared: true,
        status: "needs_connection",
      },
      "es",
    );
    expect(card.name).toBe("Gmail");
    expect(card.categoryId).toBe("email");
    expect(card.category).toBe("Correo");
    expect(card.logoMark).not.toBe("?");
    expect(card.name).not.toBe("—");
  });

  it("E. Google Calendar renders complete identity", () => {
    const def = getConnectionDefinition("google_calendar");
    expect(def).not.toBeNull();
    expect(def!.name).toBe("Google Calendar");
    expect(def!.category).toBe("calendar");
    const card = renderConnectionCard(
      {
        organizationId: "org_x",
        toolId: "google_calendar",
        label: "Google Calendar",
        declared: true,
        status: "needs_connection",
      },
      "es",
    );
    expect(card.name).toBe("Google Calendar");
    expect(card.categoryId).toBe("calendar");
    expect(card.category).toBe("Calendario");
    expect(card.logoMark).not.toBe("?");
    expect(card.name).not.toBe("—");
  });

  it("F. Google Drive renders complete identity", () => {
    const def = getConnectionDefinition("google_drive");
    expect(def).not.toBeNull();
    expect(def!.name).toBe("Google Drive");
    expect(def!.category).toBe("documents");
    const card = renderConnectionCard(
      {
        organizationId: "org_x",
        toolId: "google_drive",
        label: "Google Drive",
        declared: true,
        status: "needs_connection",
      },
      "es",
    );
    expect(card.name).toBe("Google Drive");
    expect(card.categoryId).toBe("documents");
    expect(card.category).toBe("Documentos");
    expect(card.logoMark).not.toBe("?");
    expect(card.name).not.toBe("—");
  });

  it("L. GitHub repository is a canonical connectable connection", () => {
    const def = getConnectionDefinition("github_repository");
    expect(def).not.toBeNull();
    expect(def!.name).toBe("Proyecto de la web");
    expect(def!.capabilities.map((capability) => capability.id)).toContain("repository.read");
    expect(def!.logoMark).toBeTruthy();
    const card = renderConnectionCard(null, "es", def!);
    expect(card.id).toBe("github_repository");
    expect(card.name).toBe("Proyecto de la web");
    expect(card.state).toBe("not_connected");
    expect(card.logoMark).not.toBe("?");
  });

  it("G. Resend is categorized as email, NEVER CRM", () => {
    const def = getConnectionDefinition("resend");
    expect(def).not.toBeNull();
    expect(def!.category).toBe("email");
    const card = renderConnectionCard(
      {
        organizationId: "org_x",
        toolId: "resend",
        label: "Email Delivery",
        declared: true,
        status: "configured",
        configSource: "env:resend",
      },
      "es",
    );
    // The contract that matters: the CANONICAL category id is "email",
    // not "crm". The portal groups by categoryId, so Resend will
    // appear under "Correo" — never under "CRM y automatización".
    expect(card.categoryId).toBe("email");
    expect(card.categoryId).not.toBe("crm");
  });

  it("H. Mautic remains connected/configured exactly as before", () => {
    const def = getConnectionDefinition("mautic");
    expect(def).not.toBeNull();
    expect(def!.name).toBe("Mautic");
    expect(def!.category).toBe("crm");
    expect(def!.configSourceLabel).toBe("env:mautic");
    const card = renderConnectionCard(
      {
        organizationId: "org_x",
        toolId: "mautic",
        label: "Mautic",
        declared: true,
        status: "connected",
        configSource: "env:mautic",
        verifiedAt: "2026-08-10T00:00:00.000Z",
      },
      "es",
    );
    expect(card.state).toBe("connected");
    expect(card.stateLabel).toBe("Conectado");
    expect(card.configSource).toBe("env:mautic");
    expect(card.actionLabel).toBe("Comprobar conexión");
    expect(card.name).toBe("Mautic");
    expect(card.categoryId).toBe("crm");
  });
});

describe("Connection identity contract — unknown tool", () => {
  it("I. genuinely unknown declared tool gets the intentional representation", () => {
    const card = renderConnectionCard(
      {
        organizationId: "org_x",
        toolId: "some_obscure_saas",
        label: "Some Obscure SaaS",
        declared: true,
        status: "needs_connection",
      },
      "es",
    );
    // Intentional unknowns are NEVER blank. They carry:
    //  - a name (the declared label)
    //  - a non-empty category (the "other" bucket)
    //  - the unknown logo mark
    //  - a description explaining what is happening
    expect(card.name).toBe("Some Obscure SaaS");
    expect(card.category).toBe("Otro");
    expect(card.categoryId).toBe("other");
    expect(card.state).toBe("not_connected");
    expect(card.stateLabel).toBe("Herramienta sin integración configurada");
    expect(card.description).toBe(
      "Herramienta detectada, todavía sin integración configurada.",
    );
    // The known-fallback marker must NEVER appear on the unknown bucket.
    expect(card.name).not.toBe("—");
  });

  it("J-bis. no state at all → known tool falls through intentional unknown path", () => {
    // renderConnectionCard(null) is not called by the production endpoint
    // (the endpoint iterates CONNECTION_DEFINITIONS first), but if it
    // ever is called for a toolId not in the catalog, the result must
    // be the intentional representation — not the pre-P0 blank card.
    const card = renderConnectionCard(null, "es");
    expect(card.id).toBe("unknown");
    expect(card.name).not.toBe("—");
    expect(card.categoryId).toBe("other");
    expect(card.category).toBe("Otro");
  });
});

describe("Connection identity contract — backend exposes canonical categoryId", () => {
  it("K. categoryId is one of the canonical ids for every definition", () => {
    const allowed = new Set([
      "crm",
      "email",
      "calendar",
      "documents",
      "marketing",
      "team",
      "other",
    ]);
    for (const def of CONNECTION_DEFINITIONS) {
      expect(allowed.has(def.category), `category for ${def.id}`).toBe(true);
    }
  });
});

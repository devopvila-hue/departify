import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAdminCommandAuthorized,
  parseAdminCommand,
  readAdminModelsView,
  readAdminSkillsView,
} from "../src/customer-zero/admin-chat-commands.js";
import type { AuthenticatedUser } from "@departify/auth";
import type { CustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";

const ADMIN_USER: AuthenticatedUser = { id: "11111111-1111-1111-1111-111111111111", email: "admin@example.com" };
const OTHER_USER: AuthenticatedUser = { id: "22222222-2222-2222-2222-222222222222", email: "user@example.com" };

const ORIGINAL_ENV = { ...process.env };

describe("parseAdminCommand", () => {
  it("recognises /models as an admin command", () => {
    expect(parseAdminCommand("/models")).toEqual({ command: "models" });
  });

  it("recognises /skills as an admin command", () => {
    expect(parseAdminCommand("/skills")).toEqual({ command: "skills" });
  });

  it("rejects text without a leading slash", () => {
    expect(parseAdminCommand("models")).toBeNull();
  });

  it("rejects unknown slash commands", () => {
    expect(parseAdminCommand("/rm -rf /")).toBeNull();
  });

  it("rejects slash commands with extra trailing text", () => {
    expect(parseAdminCommand("/models extra")).toBeNull();
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parseAdminCommand("   /models   ")).toEqual({ command: "models" });
  });
});

describe("isAdminCommandAuthorized — three-gate model", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"];
    delete process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"];
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("denies everyone when master switch is off (default production state)", () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"] = ADMIN_USER.id;
    expect(isAdminCommandAuthorized(ADMIN_USER)).toBe(false);
  });

  it("denies everyone when allowlist is empty", () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"] = "1";
    expect(isAdminCommandAuthorized(ADMIN_USER)).toBe(false);
  });

  it("denies non-admin even when switch + allowlist are set", () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"] = "1";
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"] = ADMIN_USER.id;
    expect(isAdminCommandAuthorized(OTHER_USER)).toBe(false);
  });

  it("authorises only users whose id is in the allowlist when both gates are on", () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"] = "1";
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"] = `${ADMIN_USER.id},${OTHER_USER.id}`;
    expect(isAdminCommandAuthorized(ADMIN_USER)).toBe(true);
    expect(isAdminCommandAuthorized(OTHER_USER)).toBe(true);
  });

  it("rejects when authUser is undefined", () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"] = "1";
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"] = ADMIN_USER.id;
    expect(isAdminCommandAuthorized(undefined)).toBe(false);
  });

  it("treats DEPARTIFY_GOLDEN_IMAGE_ADMIN=true the same as =1", () => {
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"] = "true";
    process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"] = ADMIN_USER.id;
    expect(isAdminCommandAuthorized(ADMIN_USER)).toBe(true);
  });
});

/**
 * Smoke tests for the runtime introspection views. They do not require
 * a real LLM router config — they assert the views degrade honestly when
 * no providers are wired (which is the test env).
 */
describe("admin runtime views", () => {
  const fakeSession = {
    state: {
      connections: new Map([
        ["mautic", { toolId: "mautic", label: "Mautic", status: "connected", capability: "crm.contacts.list" }],
        ["github", { toolId: "github", label: "GitHub", status: "needs_attention", capability: "seo.repository.read" }],
      ]),
      locale: "es-ES",
    },
    capabilities: {
      list: () => [
        { id: "seo.audit.website", label: "Auditoría SEO", name: "Auditoría SEO" },
        { id: "seo.repository.read", label: "Leer repositorio", name: "Leer repositorio" },
        { id: "marketing.social.publish", label: "Publicar en redes", name: "Publicar en redes" },
      ],
    },
  } as unknown as CustomerZeroSession;

  it("models view always has a title and never throws when router is missing", async () => {
    const view = await readAdminModelsView(fakeSession);
    expect(view.title).toMatch(/LLM Router/);
    expect(Array.isArray(view.providers)).toBe(true);
  });

  it("skills view lists Marketing specialists, granted capabilities and SEO capabilities", async () => {
    const view = await readAdminSkillsView(fakeSession);
    expect(view.departmentIdentity.specialists.map((s) => s.id)).toContain("agent_marketing_director");
    expect(view.departmentIdentity.specialists.map((s) => s.id)).toContain("agent_content_strategist");
    expect(view.grantedCapabilities).toEqual(
      expect.arrayContaining(["crm.contacts.list", "seo.repository.read"]),
    );
    expect(view.seoCapabilities.map((c) => c.id)).toEqual([
      "seo.audit.website",
      "seo.repository.read",
    ]);
    expect(view.knowledgeCollections.map((c) => c.id)).toContain("kcol_marketing_playbook");
  });
});
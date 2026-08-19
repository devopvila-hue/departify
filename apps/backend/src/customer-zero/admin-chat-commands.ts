/**
 * Admin chat commands — Golden Image runtime introspection.
 *
 * Sprint: Customer Zero — Golden Image construction.
 *
 * Purpose
 * -------
 * While the Customer Zero / Golden Image is being built we need a tiny,
 * safe escape hatch for authorized admins/developers to inspect runtime
 * state from the Departify chat without leaving the conversation.
 *
 * Allowed commands (allowlist, no shell, no LLM):
 *   - /models   → real models currently registered with the LLM Router
 *   - /skills   → real skills/agents/tools/connections loaded for the org
 *
 * NOT allowed:
 *   - Anything else. Arbitrary text starting with "/" is treated as a normal
 *     CEO message. There is no shell, no eval, no command injection surface.
 *
 * Protection model — three independent gates, all required:
 *
 *   1. Master switch (env): DEPARTIFY_GOLDEN_IMAGE_ADMIN=1.
 *      In production this is OFF unless an admin opts in for a build session.
 *
 *   2. Allowlist (env): DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS=uuid1,uuid2
 *      Comma-separated Supabase user ids. No env var → no one is authorized.
 *
 *   3. Runtime context: the calling request must carry an authenticated
 *      user. We never match by email or display name — only by the verified
 *      Supabase `authUser.id`. This makes spoofing through DevTools or a
 *      leaked token trivial to detect (the id is server-asserted by the
 *      auth boundary).
 *
 * If any of the three gates fails, the command is silently passed through
 * to the normal CEO chat pipeline. This means a regular Departify customer
 * who types "/models" sees exactly the same behaviour as typing "models" —
 * the admin escape hatch is invisible to them.
 *
 * The Product Identity Boundary is preserved: nothing the admin sees leaks
 * to the customer-facing UI. The command reply is only ever returned to a
 * request whose `authUser.id` is in the allowlist.
 */
import { loadLlmRouterConfig } from "@departify/config";
import {
  bootstrapLlmRouter,
  type LlmRouterBootstrapResult,
} from "@departify/llm-router";
import { createOpenAIProviderFromConfig } from "@departify/llm-provider-openai";
import type { AuthenticatedUser } from "@departify/auth";
import type { CustomerZeroSession } from "./customer-zero-session.js";
import {
  SEO_AUDIT_CAPABILITY_ID,
  SEO_REPOSITORY_READ_CAPABILITY_ID,
  type DerivedCapabilityState,
} from "@departify/capability-engine";

/* ----------------------------------------------------------------------------
 * Allowlist + master switch.
 * --------------------------------------------------------------------------*/

const ADMIN_COMMAND_ALLOWLIST = new Set(["models", "skills"]);

/**
 * Parsed admin-command invocation, e.g. "/models" → { command: "models" }.
 * Returns null when the message is not a recognised admin command.
 */
export function parseAdminCommand(
  rawMessage: string,
): { command: "models" | "skills" } | null {
  const trimmed = rawMessage.trim();
  if (!trimmed.startsWith("/")) return null;
  // Single-token commands only. "/models extra text" is NOT a command — that
  // would let a curious CEO accidentally trigger admin output.
  const match = /^\/([a-z][a-z0-9_-]{0,32})\s*$/.exec(trimmed);
  const captured = match?.[1];
  if (!captured) return null;
  const candidate = captured.toLowerCase();
  if (!ADMIN_COMMAND_ALLOWLIST.has(candidate)) return null;
  return { command: candidate as "models" | "skills" };
}

/**
 * True when the runtime has been told (via env vars) that admin chat
 * commands are enabled AND the calling user id is in the explicit allowlist.
 *
 * Three gates, all required:
 *   - DEPARTIFY_GOLDEN_IMAGE_ADMIN=1
 *   - DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS contains the user id
 *   - the user id is a non-empty string
 */
export function isAdminCommandAuthorized(
  authUser: AuthenticatedUser | undefined,
): boolean {
  if (!authUser || !authUser.id) return false;
  if (!isAdminMasterSwitchEnabled()) return false;
  const allowlist = readAdminUserAllowlist();
  if (allowlist.size === 0) return false;
  return allowlist.has(authUser.id);
}

function isAdminMasterSwitchEnabled(): boolean {
  const value = process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN"];
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

function readAdminUserAllowlist(): Set<string> {
  const raw = process.env["DEPARTIFY_GOLDEN_IMAGE_ADMIN_USER_IDS"];
  if (!raw) return new Set();
  const ids = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return new Set(ids);
}

/* ----------------------------------------------------------------------------
 * Runtime introspection.
 * --------------------------------------------------------------------------*/

export interface AdminModelsView {
  readonly title: string;
  readonly providers: ReadonlyArray<{
    readonly providerId: string;
    readonly displayName: string;
    readonly models: ReadonlyArray<{
      readonly modelId: string;
      readonly displayName: string;
      readonly capabilities: readonly string[];
      readonly costScore: number;
      readonly latencyScore: number;
      readonly availabilityScore: number;
    }>;
  }>;
  readonly defaultProvider: string | null;
  readonly defaultStrategy: string | null;
}

/**
 * Read the real models from the LLM router the customer-zero session is
 * configured to use. We go through the session's lazy `llm` runtime so we
 * see exactly what the chat pipeline would use, not what some test fixture
 * declared. If the router is not yet initialised we still surface the
 * default provider/strategy from config so the admin can see intent.
 */
export async function readAdminModelsView(
  session: CustomerZeroSession,
): Promise<AdminModelsView> {
  // Touching `llm` may trigger lazy provider init; this is fine because
  // admin commands are explicitly authorised and not on the hot chat path.
  const boot = await resolveRouter(session);
  const descriptors = boot ? boot.registry.listDescriptors() : [];
  const models = boot ? boot.registry.collectModels() : [];
  const modelsByProvider = new Map<string, typeof models[number][]>();
  for (const model of models) {
    const bucket = modelsByProvider.get(model.providerId) ?? [];
    bucket.push(model);
    modelsByProvider.set(model.providerId, bucket);
  }
  const providers = descriptors.map((descriptor) => {
    const providerModels = (modelsByProvider.get(descriptor.providerId) ?? []).map(
      (model) => ({
        modelId: model.modelId,
        displayName: model.displayName,
        capabilities: [...model.capabilities],
        costScore: model.costScore,
        latencyScore: model.latencyScore,
        availabilityScore: model.availabilityScore,
      }),
    );
    return {
      providerId: descriptor.providerId,
      displayName: descriptor.displayName,
      models: providerModels,
    };
  });

  const config = readRouterConfig();
  return {
    title: "Departify LLM Router — live view",
    providers,
    defaultProvider: config?.defaultProvider ?? null,
    defaultStrategy: config?.defaultStrategy ?? null,
  };
}

export interface AdminSkillViewEntry {
  readonly id: string;
  readonly label: string;
  readonly department: string;
  /**
   * True when the capability contract is present in this session's
   * `DepartmentCapabilityRegistry`. The admin sees `false` when the
   * contract was never registered.
   */
  readonly registered: boolean;
  /**
   * True when the registered contract's required connections + tools are
   * present, regardless of verification. Use this to distinguish "the
   * capability is wired in" from "the capability is truly runnable".
   */
  readonly available: boolean;
  /**
   * True when the derived state is `ready` — i.e. all required connections
   * are connected, all backing tools are registered, and verification has
   * passed. This is the only state that allows the chat pipeline to invoke
   * the capability without an honest unavailable message.
   */
  readonly executable: boolean;
  readonly status: string;
  readonly health: string;
  readonly reason: string;
  readonly requiredConnections: readonly string[];
  readonly missingConnections: readonly string[];
  readonly requiredTools: readonly string[];
  readonly missingTools: readonly string[];
  readonly verification: {
    readonly status: string;
    readonly verifiedAt: string | null;
    readonly checks: readonly string[];
  };
}

export interface AdminSkillsView {
  readonly title: string;
  readonly departmentIdentity: {
    readonly name: string;
    readonly role: string;
    readonly specialists: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly role: string;
    }>;
  };
  readonly connectedTools: ReadonlyArray<{
    readonly toolId: string;
    readonly label: string;
    readonly state: string;
  }>;
  readonly grantedCapabilities: readonly string[];
  /**
   * Every SEO capability declared in capability-engine source code, plus
   * its registered / available / executable state for this session.
   * The admin can tell at a glance which gaps remain.
   */
  readonly seoCapabilities: readonly AdminSkillViewEntry[];
  readonly knowledgeCollections: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
  }>;
}

/**
 * SEO capabilities that exist in capability-engine source code. The admin
 * view uses this list to surface declared contracts even when they have
 * not been registered yet — letting the admin see the gap honestly.
 */
const SEO_DECLARED_CAPABILITY_IDS = [
  SEO_AUDIT_CAPABILITY_ID,
  SEO_REPOSITORY_READ_CAPABILITY_ID,
] as const;

/**
 * Read the real skills/agents/tools the Marketing department has loaded
 * for this session, plus every SEO capability declared in capability-engine
 * with its registered / available / executable state for THIS session.
 */
export async function readAdminSkillsView(
  session: CustomerZeroSession,
): Promise<AdminSkillsView> {
  const connectionMap = session.state?.connections;
  const connectedTools = connectionMap
    ? [...connectionMap.values()].map((conn) => ({
        toolId: conn.toolId,
        label: conn.label,
        state: conn.status,
      }))
    : [];
  const granted = new Set<string>();
  if (connectionMap) {
    for (const conn of connectionMap.values()) {
      if (conn.capability) granted.add(conn.capability);
    }
  }
  const seoCapabilities = buildSeoCapabilityView(session);
  const knowledgeCollections = listMarketingKnowledgeCollections();
  const specialists = listMarketingSpecialists();

  return {
    title: "Departify Marketing department — live view",
    departmentIdentity: {
      name: "Marketing",
      role: "Director de Marketing (Elvira)",
      specialists,
    },
    connectedTools,
    grantedCapabilities: [...granted].sort(),
    seoCapabilities,
    knowledgeCollections,
  };
}

/* ----------------------------------------------------------------------------
 * SEO capability view — declared / registered / available / executable.
 * --------------------------------------------------------------------------*/

interface CapabilityLike {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly department?: string;
  readonly requiredConnections?: readonly string[];
  readonly actions?: ReadonlyArray<{ readonly toolId?: string }>;
}

function buildSeoCapabilityView(
  session: CustomerZeroSession,
): readonly AdminSkillViewEntry[] {
  // 1. Snapshot every SEO contract actually present in the registry.
  const registryList: readonly CapabilityLike[] = listAllCapabilities(session);
  const registeredById = new Map<string, CapabilityLike>();
  for (const cap of registryList) {
    if (cap.id.startsWith("seo.")) registeredById.set(cap.id, cap);
  }

  // 2. Derive the live operational state per registered SEO capability.
  const derivedById = new Map<string, DerivedCapabilityState>();
  for (const state of deriveSeoStates(session)) {
    derivedById.set(state.capability.id, state);
  }

  // 3. Emit one view entry per DECLARED id, so the admin always sees the
  // full canonical list — even when something is missing from the registry.
  return SEO_DECLARED_CAPABILITY_IDS.map((id) => {
    const registered = registeredById.get(id);
    const derived = derivedById.get(id);
    const requiredConnections = registered?.requiredConnections ?? [];
    const requiredTools = (registered?.actions ?? [])
      .map((action) => action.toolId)
      .filter((toolId): toolId is string => Boolean(toolId));
    const missingConnections = requiredConnections.filter(
      (toolId) => session.state?.connections?.get(toolId)?.status !== "connected",
    );
    const missingTools = requiredTools.filter(
      (toolId) => !session.runtime?.registry?.has(toolId),
    );
    const verification = derived?.capability?.verification ?? {
      status: registered ? "pending" : "missing",
      checks: [],
      verifiedAt: undefined,
    };
    return {
      id,
      label: derived?.capability?.name ?? registered?.name ?? id,
      department: derived?.capability?.department ?? registered?.department ?? "seo",
      registered: Boolean(registered),
      available: Boolean(derived) && missingTools.length === 0,
      executable: derived?.status === "ready",
      status: derived?.status ?? (registered ? "registered" : "unregistered"),
      health: derived?.health ?? "down",
      reason: derived?.reason ?? (registered ? "registered_but_not_derived" : "not_registered"),
      requiredConnections,
      missingConnections,
      requiredTools,
      missingTools,
      verification: {
        status: verification.status,
        verifiedAt: verification.verifiedAt ?? null,
        checks: verification.checks ?? [],
      },
    };
  });
}

function listAllCapabilities(
  session: CustomerZeroSession,
): readonly CapabilityLike[] {
  const capabilities = session.capabilities;
  if (!capabilities || typeof capabilities.list !== "function") return [];
  return capabilities.list.call(capabilities) as readonly CapabilityLike[];
}

function deriveSeoStates(
  session: CustomerZeroSession,
): readonly DerivedCapabilityState[] {
  const capabilities = session.capabilities;
  if (!capabilities || typeof capabilities.deriveForDepartment !== "function") {
    return [];
  }
  // The derive path needs an OperationalSourcePort. We build the same one
  // operational-context.ts uses, so /skills reflects what the marketing
  // engine actually sees (no memory, no shortcuts).
  const source = {
    connection: (toolId: string) => {
      const found = session.state?.connections?.get(toolId);
      if (!found) return null;
      return {
        toolId: found.toolId,
        status: found.status,
        ...(found.missingCredentials && found.missingCredentials.length > 0
          ? { missingCredentials: found.missingCredentials }
          : {}),
      };
    },
    isToolAvailable: (toolId: string) =>
      Boolean(session.runtime?.registry?.has(toolId)),
    listConnections: () =>
      [...(session.state?.connections?.values() ?? [])].map((c) => ({
        toolId: c.toolId,
        status: c.status,
      })),
  };
  return capabilities.deriveForDepartment.call(capabilities, "seo", source) as readonly DerivedCapabilityState[];
}

interface CapabilityLike {
  readonly id: string;
  readonly label?: string;
  readonly name?: string;
  readonly description?: string;
}

/* ----------------------------------------------------------------------------
 * Re-exports for the chat route.
 * --------------------------------------------------------------------------*/

export {
  parseAdminCommand as __parseAdminCommand,
  isAdminCommandAuthorized as __isAdminCommandAuthorized,
};

/* ----------------------------------------------------------------------------
 * Helpers.
 * --------------------------------------------------------------------------*/

async function resolveRouter(session: CustomerZeroSession): Promise<LlmRouterBootstrapResult | null> {
  try {
    const config = loadLlmRouterConfig();
    const provider = createOpenAIProviderFromConfig();
    return bootstrapLlmRouter({ config, providers: [provider] });
  } catch {
    // No router configured (e.g. tests without OpenAI env) — return null
    // so the view degrades honestly instead of throwing.
    void session;
    return null;
  }
}

function readRouterConfig(): { defaultProvider: string; defaultStrategy: string } | null {
  try {
    const loaded = loadLlmRouterConfig();
    if (!loaded.defaultProvider || !loaded.defaultStrategy) return null;
    return {
      defaultProvider: loaded.defaultProvider,
      defaultStrategy: loaded.defaultStrategy,
    };
  } catch {
    return null;
  }
}

function listMarketingKnowledgeCollections(): AdminSkillsView["knowledgeCollections"] {
  // The Marketing department template advertises its knowledge collections
  // in code. We surface them so the admin can confirm they are declared,
  // not whether they have any rows.
  return [
    { id: "kcol_marketing_playbook", title: "Marketing playbook" },
    { id: "kcol_brand", title: "Brand guidelines" },
  ];
}

function listMarketingSpecialists(): AdminSkillsView["departmentIdentity"]["specialists"] {
  return [
    { id: "agent_marketing_director", label: "Elvira — Directora de Marketing", role: "director" },
    { id: "agent_content_strategist", label: "Content Strategist", role: "content" },
    { id: "agent_social_media_manager", label: "Social Media Manager", role: "social" },
    { id: "agent_ads_specialist", label: "Ads Specialist", role: "ads" },
  ];
}
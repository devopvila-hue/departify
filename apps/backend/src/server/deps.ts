import type { AuthService } from "@departify/auth";
import type { OrganizationStore } from "../auth/tenant-contracts.js";
import type { ToolStateStore } from "../customer-zero/tool-state.js";
import type { ConversationStore } from "../customer-zero/conversation-store.js";

/**
 * Server dependencies — Phase P0-A / P-B.
 *
 * The production host wires real Supabase implementations; tests inject
 * fakes. `auth`/`organizations`/`toolState`/`conversations` are optional at
 * construction so non-auth route tests remain deterministic — but the
 * production entry point (`main.ts`) always wires them.
 */
export interface ServerDeps {
  auth?: AuthService;
  organizations?: OrganizationStore;
  /** Durable organization-scoped tool/connection state (Phase P-B). */
  toolState?: ToolStateStore;
  /** Durable organization-scoped conversations (Phase P-B part 15). */
  conversations?: ConversationStore;
  /** Public base URL of the portal, used to build OAuth redirect URIs. */
  publicBaseUrl?: string;
}

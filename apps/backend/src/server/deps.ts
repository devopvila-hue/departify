import type { AuthService } from "@departify/auth";
import type { OrganizationStore } from "../auth/tenant-contracts.js";

/**
 * Server dependencies — Phase P0-A.
 *
 * The production host wires real Supabase implementations; tests inject
 * fakes. `auth`/`organizations` are optional at construction so non-auth
 * route tests remain deterministic — but the production entry point
 * (`main.ts`) always wires them.
 */
export interface ServerDeps {
  auth?: AuthService;
  organizations?: OrganizationStore;
  /** Public base URL of the portal, used to build OAuth redirect URIs. */
  publicBaseUrl?: string;
}

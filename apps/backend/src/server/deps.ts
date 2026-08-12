import type { AuthService } from "@departify/auth";
import type { EngineAdapter } from "@departify/engine-adapter";
import type { EngineRuntimePolicy } from "@departify/config";
import type { OrganizationStore } from "../auth/tenant-contracts.js";
import type { ToolStateStore } from "../customer-zero/tool-state.js";
import type { ConversationStore } from "../customer-zero/conversation-store.js";
import type { CompanyDnaStore } from "../customer-zero/company-dna.js";
import type { InboxStore } from "../customer-zero/inbox-domain.js";
import type { MarketingService } from "../customer-zero/marketing-service.js";
import type { DepartmentWorkStore } from "../customer-zero/department-work.js";

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
  /**
   * Durable canonical Company DNA (Customer Zero P0). The readiness gate
   * is evaluated against this store and nothing else — in-memory session
   * state can never prove that Departify understands the company.
   */
  companyDna?: CompanyDnaStore;
  /** Durable organization-scoped unified inbox (Customer Zero 03). */
  inbox?: InboxStore;
  /** Durable DepartmentTask/DepartmentResult store. */
  workStore?: DepartmentWorkStore;
  /** Public base URL of the portal, used to build OAuth redirect URIs. */
  publicBaseUrl?: string;
  /** Provider-independent engine adapter (Sprint ENGINE 02). */
  engine?: EngineAdapter;
  /** Departify-owned Marketing department service (Sprint ENGINE 03). */
  marketing?: MarketingService;
  /** Production engine runtime policy (DEPLOY 01). */
  engineRuntimePolicy?: EngineRuntimePolicy;
  /** Enables the experimental native OpenClaw company.context slice. */
  nativeBusinessTools?: boolean;
}

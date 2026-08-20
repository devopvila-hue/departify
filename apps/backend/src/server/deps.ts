import type { AuthService } from "@departify/auth";
import type { EngineAdapter } from "@departify/engine-adapter";
import type { EngineRuntimePolicy } from "@departify/config";
import type { OrganizationStore } from "../auth/tenant-contracts.js";
import type { ToolStateStore } from "../customer-zero/tool-state.js";
import type { ConversationStore } from "../customer-zero/conversation-store.js";
import type { CompanyDnaStore } from "../customer-zero/company-dna.js";
import type { InboxStore } from "../customer-zero/inbox-domain.js";
import type { MarketingService } from "../customer-zero/marketing-service.js";
import type { MarketingActivityRepository } from "../customer-zero/marketing-repositories.js";
import type { DepartmentWorkStore } from "../customer-zero/department-work.js";
import type { DepartmentDashboardStore } from "../customer-zero/department-dashboards.js";
import type { DepartmentMemoryStore } from "../customer-zero/department-memory.js";
import type { ConnectorRuntime, ConnectorRuntimeCandidate } from "@departify/connector-runtime";
import type { SeoRepositoryLinkStore } from "../customer-zero/seo-repository.js";
import type { LlmCredentialStore } from "../customer-zero/llm-credentials.js";
import type { OrganizationBrandingStore } from "../customer-zero/organization-branding.js";
import type { WeeklyPlanStore } from "../customer-zero/weekly-plans.js";
import type { PdfArtifactStore } from "../customer-zero/pdf-artifact-store.js";
import type { PendingWorkStore } from "../customer-zero/pending-work-store.js";

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
  /** Durable organization + conversation scoped pending actions (Sprint 68.1). */
  pendingWork?: PendingWorkStore;
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
  /** Durable schema-driven dashboard definitions. */
  dashboardStore?: DepartmentDashboardStore;
  /** Durable department knowledge; the session keeps only a bounded hot cache. */
  departmentMemory?: DepartmentMemoryStore;
  /** Public base URL of the portal, used to build OAuth redirect URIs. */
  publicBaseUrl?: string;
  /** Provider-independent engine adapter (Sprint ENGINE 02). */
  engine?: EngineAdapter;
  /** Departify-owned Marketing department service (Sprint ENGINE 03). */
  marketing?: MarketingService;
  /** Durable Marketing activity/audit repository. */
  marketingActivity?: MarketingActivityRepository;
  /** Production engine runtime policy (DEPLOY 01). */
  engineRuntimePolicy?: EngineRuntimePolicy;
  /** Enables the experimental native OpenClaw company.context slice. */
  nativeBusinessTools?: boolean;
  /** Provider-independent connector execution runtime. */
  connectorRuntime?: ConnectorRuntime;
  /** Provider candidates selected by capability and the official-first policy. */
  connectorRuntimes?: readonly ConnectorRuntimeCandidate[];
  /** Tenant-bound WordPress/Shopify runtime. */
  marketingConnectorRuntime?: ConnectorRuntime;
  /** Durable SEO website-to-repository association. */
  seoRepositoryLinks?: SeoRepositoryLinkStore;
  /** Durable organization-owned BYOK credential vault. */
  llmCredentials?: LlmCredentialStore;
  /** Durable organization-owned branding (logo + brand name). */
  branding?: OrganizationBrandingStore;
  /** Durable organization-owned weekly operating plan (Operating Loop). */
  weeklyPlans?: WeeklyPlanStore;
  /** Durable PDF artifact storage. */
  pdfArtifactStore?: PdfArtifactStore;
}

/**
 * Sprint 67 P0.6 — Founder Build Mode.
 *
 * Two distinct operational modes for Departify:
 *
 * 1. FOUNDER / GOLDEN IMAGE BUILD MODE
 *    - Privileged execution for the founder/Customer Zero
 *    - Can install packages, tools, skills
 *    - Can execute commands, scripts, tests
 *    - Can create/modify files within authorized workspace
 *    - Can incorporate new capabilities dynamically
 *    - Server-side authorization only
 *
 * 2. CLIENT PRODUCTION MODE
 *    - Restricted mode for end customers
 *    - Only executes approved/entitled capabilities
 *    - No autonomous installation
 *    - No runtime modification
 *
 * Authorization is server-side only. A client user CANNOT activate
 * Founder Mode by sending "activa founder mode" via chat.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OperationalMode = "FOUNDER_BUILD" | "CLIENT_PRODUCTION";

export type CapabilityResolutionState =
  | "AVAILABLE"           // Ready to execute
  | "NEEDS_CONNECTION"    // Requires OAuth/API connection
  | "NEEDS_APPROVAL"      // Requires explicit approval
  | "NOT_INSTALLED"       // Tool/package not installed
  | "NOT_ENTITLED"        // User doesn't have entitlement
  | "FORBIDDEN";          // Never allowed (security)

export type CapabilityLifecycleState =
  | "EXPERIMENTAL"        // Just discovered/installed
  | "VALIDATED"           // Tested and working
  | "GOLDEN_APPROVED";    // Approved for Golden Image

export interface FounderAuthorization {
  readonly mode: OperationalMode;
  readonly userId: string;
  readonly organizationId: string;
  readonly authorizedAt: string;
  readonly authorizedBy: "server_role_check" | "explicit_founder";
}

export interface AuditTrailEntry {
  readonly timestamp: string;
  readonly actor: string;
  readonly operation: string;
  readonly tool?: string;
  readonly capability?: string;
  readonly targetWorkspace?: string;
  readonly result: "success" | "failure" | "blocked";
  readonly details?: string;
  // NEVER store secrets
}

export interface WorkspaceBoundary {
  readonly allowed: readonly string[];
  readonly forbidden: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Authorized workspaces for Founder Build Mode.
 * Operations outside these paths are blocked.
 */
export const FOUNDER_WORKSPACE_BOUNDARIES: WorkspaceBoundary = {
  allowed: [
    "/opt/opencloud-platform",
    "/tmp/deptia",
    "/tmp/opencloud-client",
    "/opt/Deptify-DNA",
    "/Volumes/MiDisco/Departify",
  ],
  forbidden: [
    "/opt/moon-ai",
    "/root/openclaw-mission-control",
    "nivel-oculto",
    "youtube",
    "MoneyPrinter",
  ],
};

/**
 * Operations that are destructive/irreversible and require confirmation
 * even in Founder Build Mode.
 */
export const DESTRUCTIVE_OPERATIONS = new Set([
  "delete_data",
  "delete_repository",
  "reset_database",
  "delete_production",
  "rotate_secrets",
  "delete_secrets",
  "destroy_infrastructure",
  "force_push",
  "drop_table",
  "truncate_table",
]);

/**
 * Operations that are safe to execute in Founder Build Mode
 * without additional confirmation.
 */
export const SAFE_FOUNDER_OPERATIONS = new Set([
  "install_package",
  "install_dependency",
  "install_skill",
  "install_tool",
  "add_adapter",
  "configure_tool",
  "create_file",
  "modify_file",
  "read_file",
  "execute_script",
  "execute_test",
  "execute_build",
  "use_package_manager",
  "inspect_runtime",
  "incorporate_capability",
  "test_capability",
  "configure_integration",
  "use_cli",
  "diagnose_error",
  "repair_tool",
  "generate_document",
  "use_drive",
  "use_github",
]);

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Check if a user is authorized for Founder Build Mode.
 * This is SERVER-SIDE only. Never trust a client-side toggle.
 *
 * Uses existing role/identity contracts.
 */
export function checkFounderAuthorization(
  userId: string | undefined,
  organizationId: string,
  userRole?: string,
): FounderAuthorization | null {
  // In the Golden Image / Customer Zero phase, the founder is the
  // owner of the organization. This uses existing role contracts.
  if (!userId) return null;

  // During BUILD MODE, the founder is identified by:
  // 1. Being the organization owner
  // 2. Having an explicit founder flag (future)
  // 3. Being in the Customer Zero organization
  //
  // For now, we check if the user is the org owner.
  // The role check uses existing OrganizationStore contracts.
  const isFounder = userRole === "owner" || userRole === "founder";
  if (!isFounder) return null;

  return {
    mode: "FOUNDER_BUILD",
    userId,
    organizationId,
    authorizedAt: new Date().toISOString(),
    authorizedBy: "server_role_check",
  };
}

/**
 * Check if a specific operation is allowed in Founder Build Mode.
 */
export function isOperationAllowedInFounderMode(
  operation: string,
  targetPath?: string,
): { allowed: boolean; reason?: string } {
  // Check destructive operations
  if (DESTRUCTIVE_OPERATIONS.has(operation)) {
    return {
      allowed: false,
      reason: `Operation "${operation}" is destructive and requires explicit approval.`,
    };
  }

  // Check workspace boundaries
  if (targetPath) {
    const isForbidden = FOUNDER_WORKSPACE_BOUNDARIES.forbidden.some(
      (forbidden) => targetPath.startsWith(forbidden) || targetPath.includes(forbidden),
    );
    if (isForbidden) {
      return {
        allowed: false,
        reason: `Path "${targetPath}" is outside authorized workspace boundaries.`,
      };
    }

    const isAllowed = FOUNDER_WORKSPACE_BOUNDARIES.allowed.some(
      (allowed) => targetPath.startsWith(allowed) || targetPath.includes(allowed),
    );
    if (!isAllowed && targetPath.startsWith("/")) {
      return {
        allowed: false,
        reason: `Path "${targetPath}" is not in the authorized workspace list.`,
      };
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Capability Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the state of a capability for the current operational mode.
 *
 * In FOUNDER_BUILD mode:
 * - NOT_INSTALLED → may install/integrate
 * - NEEDS_CONNECTION → may configure
 * - NOT_ENTITLED → evaluate as development capability
 *
 * In CLIENT_PRODUCTION mode:
 * - NOT_INSTALLED → unavailable
 * - NEEDS_CONNECTION → guide connection
 * - NOT_ENTITLED → upgrade prompt
 */
export function resolveCapabilityState(
  capability: string,
  mode: OperationalMode,
  options: {
    isInstalled?: boolean;
    isConnected?: boolean;
    isApproved?: boolean;
    isEntitled?: boolean;
    isForbidden?: boolean;
  } = {},
): CapabilityResolutionState {
  if (options.isForbidden) return "FORBIDDEN";

  if (mode === "FOUNDER_BUILD") {
    if (options.isInstalled && options.isConnected) return "AVAILABLE";
    if (options.isInstalled && !options.isConnected) return "NEEDS_CONNECTION";
    if (!options.isInstalled) return "NOT_INSTALLED"; // May install in Founder mode
    if (!options.isEntitled) return "NOT_ENTITLED"; // Evaluate in Founder mode
    return "AVAILABLE";
  }

  // CLIENT_PRODUCTION mode
  if (!options.isInstalled) return "NOT_INSTALLED";
  if (!options.isConnected) return "NEEDS_CONNECTION";
  if (options.isApproved === false) return "NEEDS_APPROVAL";
  if (!options.isEntitled) return "NOT_ENTITLED";
  return "AVAILABLE";
}

/**
 * Determine if a capability can be dynamically acquired in the current mode.
 */
export function canAcquireCapability(
  state: CapabilityResolutionState,
  mode: OperationalMode,
): boolean {
  if (mode === "FOUNDER_BUILD") {
    // In Founder mode, NOT_INSTALLED can be resolved by installing
    return state === "NOT_INSTALLED" || state === "NEEDS_CONNECTION";
  }
  // In Client mode, never allow autonomous acquisition
  return false;
}

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------

const auditTrail: AuditTrailEntry[] = [];

/**
 * Log a privileged operation to the audit trail.
 * NEVER stores secrets.
 */
export function auditLog(entry: Omit<AuditTrailEntry, "timestamp">): void {
  auditTrail.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });

  // Also log to console for immediate observability
  console.info("[founder-audit]", {
    actor: entry.actor,
    operation: entry.operation,
    tool: entry.tool,
    capability: entry.capability,
    target: entry.targetWorkspace,
    result: entry.result,
  });
}

/**
 * Get the audit trail (for admin inspection).
 * Returns entries for a specific organization, most recent first.
 */
export function getAuditTrail(
  organizationId: string,
  limit = 50,
): AuditTrailEntry[] {
  // In production this would query a durable store.
  // For now, return in-memory entries.
  return auditTrail
    .filter((entry) => entry.actor.includes(organizationId))
    .slice(-limit)
    .reverse();
}

// ---------------------------------------------------------------------------
// Transformation Intent Detection
// ---------------------------------------------------------------------------

export type TransformationType =
  | "pdf"
  | "docx"
  | "email"
  | "drive"
  | "summary"
  | "download"
  | "unknown";

export interface TransformationIntent {
  readonly type: TransformationType;
  readonly confidence: number;
  readonly referent: "previous_result" | "previous_analysis" | "explicit_content";
}

/**
 * Detect if a message is a transformation request (not a new business task).
 *
 * Examples:
 * - "sí, en PDF" → transform previous result to PDF
 * - "guárdalo en Drive" → save previous artifact to Drive
 * - "mándamelo por email" → email previous result
 * - "hazme un resumen" → summarize previous result
 *
 * These must NOT trigger department routing (SEO, Marketing, etc.)
 */
export function detectTransformationIntent(
  message: string,
): TransformationIntent | null {
  const lower = message.toLocaleLowerCase("es-ES");

  // PDF transformation
  if (/\b(pdf)\b/i.test(lower)) {
    const isFollowUp = /^(?:sí|si|ok|dale|vale|de\s+acuerdo|perfecto|genial|bien)\s*[,;]?\s*/i.test(message);
    const hasModifier = /\b(en\s+pdf|como\s+pdf|a\s+pdf|haz.*pdf|genera.*pdf|convierte.*pdf|descarga.*pdf)\b/i.test(lower);

    if (isFollowUp || hasModifier) {
      return {
        type: "pdf",
        confidence: isFollowUp ? 0.95 : 0.85,
        referent: isFollowUp ? "previous_result" : "previous_analysis",
      };
    }
  }

  // Email transformation
  if (/\b(por\s+email|env[íi]a\w*|manda\w*|m[áa]nda\w*|correo)\b/i.test(lower)) {
    const isFollowUp = /^(?:sí|si|ok|dale|vale)\s*[,;]?\s*/i.test(message);
    if (isFollowUp || /\b(env[íi]a\w*|m[áa]nda\w*|correo)\b/i.test(lower)) {
      return {
        type: "email",
        confidence: isFollowUp ? 0.9 : 0.7,
        referent: "previous_result",
      };
    }
  }

  // Drive transformation
  if (/\b(en\s+drive|guárdalo|guárdala|guarda.*drive)\b/i.test(lower)) {
    return {
      type: "drive",
      confidence: 0.85,
      referent: "previous_result",
    };
  }

  // Summary transformation
  if (/\b(resumen|resúmelo|sintetiza|haz.*resumen)\b/i.test(lower)) {
    return {
      type: "summary",
      confidence: 0.8,
      referent: "previous_result",
    };
  }

  return null;
}

/**
 * Check if a message is a transformation request that should bypass
 * department routing entirely.
 */
export function isTransformationRequest(message: string): boolean {
  return detectTransformationIntent(message) !== null;
}

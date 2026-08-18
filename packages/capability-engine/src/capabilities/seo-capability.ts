/**
 * SEO capability definition — Customer Zero Golden Image.
 *
 * Two real SEO capabilities, built from the EXISTING real SEO audit and
 * GitHub repository integration (seo-audit.ts → auditWebsite(),
 * seo-repository.ts → listGithubRepositories / inspectGithubRepository).
 * No new client is created: these contracts wrap the already-validated
 * functions in the backend's customer-zero module.
 *
 * Status is derived operationally by the DepartmentCapabilityRegistry from
 * the connection state + Tool Runtime — never from memory.
 *
 *   seo.audit.website
 *     - department: seo
 *     - requiredConnections: []    (the website is a public URL from
 *                                  Company DNA, not a connected tool)
 *     - requiredCredentials: []
 *     - The capability becomes READY when:
 *         (a) Company DNA has a website, AND
 *         (b) the auditWebsite() function is registered in the Tool Runtime
 *             (handled at session startup by the customer-zero module).
 *
 *   seo.repository.read
 *     - department: seo
 *     - requiredConnections: ["github_repository"]
 *     - requiredCredentials: []   (OAuth token resolves through the
 *                                  external OAuth store)
 *     - The capability becomes READY when:
 *         (a) github_repository connection is `connected`, AND
 *         (b) an operational access token is present in the ExternalOAuth
 *             token store for this org + user, AND
 *         (c) a SeoRepositoryLink row exists for the org + website.
 *
 * The capability registry derives these conditions via `deriveCapabilityState`
 * (see `department-capability-registry.ts`). The marketing roster / chat
 * NEVER has to inspect connections manually — the registry answers the
 * deterministic question "what can this department currently do?".
 */

import type { CapabilityContract } from "../contracts/capability-contract.js";

export const SEO_AUDIT_CAPABILITY_ID = "seo.audit.website";
export const SEO_REPOSITORY_READ_CAPABILITY_ID = "seo.repository.read";
export const SEO_DEPARTMENT = "seo";

/**
 * SEO website audit capability. Reads the public website of the company
 * (from Company DNA) and returns a structured list of SEO issues
 * (title, description, canonical, robots, headings, links, images, etc.).
 */
export function buildSeoAuditCapability(): CapabilityContract {
  return {
    id: SEO_AUDIT_CAPABILITY_ID,
    name: "Auditoría SEO de la web",
    description:
      "Lee la web pública de la empresa y devuelve una lista verificable de problemas SEO: title, description, canonical, robots, encabezados, enlaces internos, imágenes sin alt, datos estructurados, metadata social y sitemap.",
    department: SEO_DEPARTMENT,
    provider: "seo-audit",
    version: "1.0.0",
    source: "native",
    // The audit fetches a public URL — no connected tool is required. The
    // capability is executable whenever Company DNA has a website.
    requiredConnections: [],
    requiredCredentials: [],
    actions: [
      {
        id: "audit_website",
        name: "Auditar web",
        description: "Analiza la URL configurada en Company DNA y emite hallazgos priorizados.",
        toolId: "departify.seo.audit",
        kind: "read",
        riskLevel: "read",
        approvalPolicy: "auto",
      },
    ],
    readActions: ["audit_website"],
    writeActions: [],
    riskLevel: "read",
    approvalPolicy: "auto",
    verification: {
      status: "pending",
      checks: [
        "Company DNA has a website",
        "auditWebsite() returns a structured SeoAuditReport",
      ],
    },
  };
}

/**
 * SEO repository read capability. Reads the SEO-selected GitHub repository
 * (tree, likely metadata files, file hints per audit issue). Read-only:
 * never writes back.
 */
export function buildSeoRepositoryReadCapability(): CapabilityContract {
  return {
    id: SEO_REPOSITORY_READ_CAPABILITY_ID,
    name: "Lectura del repositorio SEO",
    description:
      "Lista los repositorios GitHub del usuario y lee el árbol del repositorio seleccionado para SEO: archivos de metadata, layout, sitemap, robots, configuración de framework. Solo lectura.",
    department: SEO_DEPARTMENT,
    provider: "github",
    version: "1.0.0",
    source: "integration",
    requiredConnections: ["github_repository"],
    requiredCredentials: [],
    actions: [
      {
        id: "list_repositories",
        name: "Listar repositorios",
        description: "Lista los repositorios del usuario conectado a GitHub.",
        toolId: "departify.seo.repository.list",
        kind: "read",
        riskLevel: "read",
        approvalPolicy: "auto",
      },
      {
        id: "inspect_repository",
        name: "Inspeccionar repositorio",
        description:
          "Lee el árbol del repositorio SEO seleccionado y produce file hints por hallazgo de auditoría.",
        toolId: "departify.seo.repository.inspect",
        kind: "read",
        riskLevel: "read",
        approvalPolicy: "auto",
      },
    ],
    readActions: ["list_repositories", "inspect_repository"],
    writeActions: [],
    riskLevel: "read",
    approvalPolicy: "auto",
    verification: {
      status: "pending",
      checks: [
        "github_repository connection is `connected`",
        "ExternalOAuth token store has an operational access token",
        "seo_repository_links has a row for this organization + website",
      ],
    },
  };
}

/**
 * Certify a SEO capability after a real round-trip succeeded.
 *
 * `verifiedAt` is the ISO timestamp of the real call. The contract never
 * auto-presents as verified — this is the only path that flips
 * `verification.status` to `passed`, mirroring `certifyMauticCapability`.
 */
export function certifySeoCapability(
  capability: CapabilityContract,
  verifiedAt: string,
): CapabilityContract {
  return {
    ...capability,
    verification: {
      status: "passed",
      checks: capability.verification.checks,
      verifiedAt,
    },
  };
}
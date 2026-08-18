import type { AuthConfig } from "@departify/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getExternalOAuthTokenStore,
} from "./external-oauth-tokens.js";

export interface SeoRepositoryLink {
  readonly organizationId: string;
  readonly departmentId: "seo";
  readonly website: string;
  readonly provider: "github";
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly defaultBranch: string;
  readonly access: "read" | "write";
  readonly selectedBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SeoRepositoryLinkStore {
  get(organizationId: string, website: string): Promise<SeoRepositoryLink | null>;
  upsert(link: SeoRepositoryLink): Promise<void>;
}

export interface SeoRepositorySummary {
  readonly id: string;
  readonly fullName: string;
  readonly private: boolean;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
}

export interface SeoRepositoryInspection {
  readonly repository: SeoRepositorySummary;
  readonly files: readonly string[];
  readonly likelyMetadataFiles: readonly string[];
  readonly issueFileHints: Readonly<Record<string, readonly string[]>>;
}

export class InMemorySeoRepositoryLinkStore implements SeoRepositoryLinkStore {
  private readonly links = new Map<string, SeoRepositoryLink>();

  async get(organizationId: string, website: string): Promise<SeoRepositoryLink | null> {
    return this.links.get(`${organizationId}:${website}`) ?? null;
  }

  async upsert(link: SeoRepositoryLink): Promise<void> {
    this.links.set(`${link.organizationId}:${link.website}`, link);
  }
}

interface SeoRepositoryLinkRow {
  organization_id: string;
  department_id: "seo";
  website: string;
  provider: "github";
  repository_id: string;
  repository_full_name: string;
  default_branch: string;
  access: "read" | "write";
  selected_by: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: SeoRepositoryLinkRow): SeoRepositoryLink {
  return {
    organizationId: row.organization_id,
    departmentId: row.department_id,
    website: row.website,
    provider: row.provider,
    repositoryId: row.repository_id,
    repositoryFullName: row.repository_full_name,
    defaultBranch: row.default_branch,
    access: row.access,
    selectedBy: row.selected_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SupabaseSeoRepositoryLinkStore implements SeoRepositoryLinkStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async get(organizationId: string, website: string): Promise<SeoRepositoryLink | null> {
    const { data, error } = await this.admin
      .from("seo_repository_links")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("website", website)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as SeoRepositoryLinkRow) : null;
  }

  async upsert(link: SeoRepositoryLink): Promise<void> {
    const { error } = await this.admin.from("seo_repository_links").upsert({
      organization_id: link.organizationId,
      department_id: link.departmentId,
      website: link.website,
      provider: link.provider,
      repository_id: link.repositoryId,
      repository_full_name: link.repositoryFullName,
      default_branch: link.defaultBranch,
      access: link.access,
      selected_by: link.selectedBy,
      created_at: link.createdAt,
      updated_at: link.updatedAt,
    }, { onConflict: "organization_id,department_id,website" });
    if (error) throw error;
  }
}

let installedLinkStore: SeoRepositoryLinkStore | null = null;
const fallbackLinkStore = new InMemorySeoRepositoryLinkStore();

export function setSeoRepositoryLinkStore(store: SeoRepositoryLinkStore): void {
  installedLinkStore = store;
}

export function getSeoRepositoryLinkStore(): SeoRepositoryLinkStore {
  return installedLinkStore ?? fallbackLinkStore;
}

async function githubFetch<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "DepartifySEO/1.0",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub no ha permitido esta lectura (${response.status}).`);
  return response.json() as Promise<T>;
}

export async function listGithubRepositories(
  organizationId: string,
  userId: string,
): Promise<readonly SeoRepositorySummary[]> {
  const token = await getExternalOAuthTokenStore().get(organizationId, userId, "github");
  if (!token?.accessToken || !token.operationalVerifiedAt) return [];
  const repos = await githubFetch<Array<Record<string, unknown>>>(token.accessToken, "/user/repos?sort=updated&per_page=100");
  return repos.flatMap((repo) => {
    const id = typeof repo.id === "number" ? String(repo.id) : "";
    const fullName = typeof repo.full_name === "string" ? repo.full_name : "";
    const defaultBranch = typeof repo.default_branch === "string" ? repo.default_branch : "main";
    const htmlUrl = typeof repo.html_url === "string" ? repo.html_url : "";
    if (!id || !fullName || !htmlUrl) return [];
    return [{ id, fullName, private: repo.private === true, defaultBranch, htmlUrl }];
  });
}

export async function inspectGithubRepository(input: {
  readonly organizationId: string;
  readonly userId: string;
  readonly link: SeoRepositoryLink;
  readonly issueIds: readonly string[];
}): Promise<SeoRepositoryInspection> {
  const token = await getExternalOAuthTokenStore().get(input.organizationId, input.userId, "github");
  if (!token?.accessToken || !token.operationalVerifiedAt) {
    throw new Error("El proyecto web no está conectado para lectura.");
  }
  const [owner, repository] = input.link.repositoryFullName.split("/");
  if (!owner || !repository || input.link.repositoryFullName.split("/").length !== 2) {
    throw new Error("El proyecto web seleccionado no es válido.");
  }
  const tree = await githubFetch<{ tree?: Array<{ path?: string; type?: string }> }>(
    token.accessToken,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(input.link.defaultBranch)}?recursive=1`,
  );
  const files = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string")
    .map((entry) => entry.path as string)
    .slice(0, 2_000);
  const metadataFiles = files.filter((path) =>
    // SEO-relevant files: framework layouts/pages/head/metadata, sitemap/robots
    // config files, and the most common SEO file extensions (tsx/jsx/vue/
    // html/js/json for code, xml/txt for sitemap/robots). The extension list
    // is the minimum needed to surface real-world public/sitemap.xml and
    // public/robots.txt — without it the Web ↔ Repository correlation has
    // no chance of locating the exact file the audit is flagging.
    /(^|\/)(layout|page|index|head|metadata|seo|robots|sitemap|next\.config|vite\.config)[^/]*\.(tsx?|jsx?|vue|html|js|json|xml|txt)$/i.test(path),
  );
  const hints = new Map<string, string[]>();
  for (const issueId of input.issueIds) {
    const patterns: Record<string, RegExp> = {
      "missing-title": /(layout|head|metadata|index|page)/i,
      "missing-description": /(layout|head|metadata|seo|page)/i,
      "missing-canonical": /(layout|head|metadata|seo|page)/i,
      "missing-sitemap": /(sitemap|next\.config|vite\.config)/i,
      "images-without-alt": /\.(tsx?|jsx?|vue|html)$/i,
      "missing-h1": /\.(tsx?|jsx?|vue|html)$/i,
    };
    const pattern = patterns[issueId];
    if (pattern) hints.set(issueId, metadataFiles.filter((path) => pattern.test(path)).slice(0, 8));
  }
  return {
    repository: {
      id: input.link.repositoryId,
      fullName: input.link.repositoryFullName,
      private: false,
      defaultBranch: input.link.defaultBranch,
      htmlUrl: `https://github.com/${input.link.repositoryFullName}`,
    },
    files,
    likelyMetadataFiles: metadataFiles.slice(0, 30),
    issueFileHints: Object.fromEntries(hints),
  };
}

/* ----------------------------------------------------------------------------
 * Web ↔ Repository correlation
 *
 * Given the result of `auditWebsite()` and `inspectGithubRepository()`, this
 * builds a structured markdown correlation the chat pipeline can attach to
 * the persisted DepartmentResult. It enforces the Customer Zero honesty
 * contract: every line is tagged as OBSERVED (live data from web/repo),
 * INFERRED (reasoning connecting both), or RECOMMENDED (concrete next step).
 *
 * No inference is ever presented as observed data. No recommendation is
 * presented as a fact.
 * --------------------------------------------------------------------------*/

export interface SeoIssueView {
  readonly id: string;
  readonly title: string;
  readonly impact: string;
  readonly evidence: string;
}

export interface SeoAuditLite {
  readonly url: string;
  readonly page: {
    readonly title: string;
    readonly description: string;
    readonly canonical: string | null;
    readonly robots: string | null;
    readonly headings: Readonly<Record<"h1" | "h2" | "h3", readonly string[]>>;
    readonly sitemap: "available" | "missing" | "unavailable";
    readonly imagesWithoutAlt: number;
    readonly structuredDataBlocks: number;
  };
  readonly issues: readonly SeoIssueView[];
}

export interface SeoCorrelationSection {
  /** Issue id this correlation was built for. */
  readonly issueId: string;
  /** Title from the audit (observed verbatim). */
  readonly title: string;
  /** Evidence from the audit (observed verbatim). */
  readonly observedEvidence: string;
  /** Files from the repository that this issue points at (observed). */
  readonly repositoryFiles: readonly string[];
  /** How the audit evidence and the repository evidence relate (inference). */
  readonly inference: string;
  /** Concrete next step the team can take (recommendation). */
  readonly recommendation: string;
}

export interface SeoCorrelation {
  readonly website: string;
  readonly repository: {
    readonly fullName: string;
    readonly htmlUrl: string;
    readonly defaultBranch: string;
  } | null;
  readonly sections: readonly SeoCorrelationSection[];
}

/**
 * Build a structured web ↔ repository correlation.
 *
 * Returns one `SeoCorrelationSection` per audit issue that has at least
 * one matching file hint from the repository inspection. Issues without
 * repository evidence are excluded from the correlation (not invented),
 * but the audit's own markdown section already lists them.
 */
export function buildSeoCorrelation(
  audit: SeoAuditLite,
  inspection: SeoRepositoryInspection,
): SeoCorrelation {
  const sections: SeoCorrelationSection[] = [];
  for (const issue of audit.issues) {
    const matchedFiles = inspection.issueFileHints[issue.id] ?? [];
    if (matchedFiles.length === 0) continue;
    sections.push({
      issueId: issue.id,
      title: issue.title,
      observedEvidence: issue.evidence,
      repositoryFiles: matchedFiles,
      inference: buildInference(issue, matchedFiles),
      recommendation: buildRecommendation(issue, matchedFiles, audit),
    });
  }
  return {
    website: audit.url,
    repository: {
      fullName: inspection.repository.fullName,
      htmlUrl: inspection.repository.htmlUrl,
      defaultBranch: inspection.repository.defaultBranch,
    },
    sections,
  };
}

/**
 * Render the correlation as markdown with explicit OBSERVED / INFERRED /
 * RECOMMENDED labels. The Customer Zero honesty contract requires that
 * no inference be presented as observed data.
 */
export function renderSeoCorrelationMarkdown(
  correlation: SeoCorrelation,
): string {
  const lines: string[] = [];
  lines.push(`### Web ↔ Repositorio — correlación`);
  lines.push(`Web auditada: ${correlation.website}`);
  if (correlation.repository) {
    lines.push(
      `Repositorio: ${correlation.repository.fullName} (${correlation.repository.htmlUrl}, branch \`${correlation.repository.defaultBranch}\`)`,
    );
  } else {
    lines.push(`Repositorio: (no conectado)`);
  }
  lines.push(``);
  if (correlation.sections.length === 0) {
    lines.push(
      `No se ha podido correlacionar ningún hallazgo con archivos concretos del repositorio.`,
    );
    lines.push(
      `La auditoría sigue siendo válida por sí sola; revisar manualmente los archivos del repositorio para los hallazgos pendientes.`,
    );
    return lines.join("\n");
  }
  for (const section of correlation.sections) {
    lines.push(`#### ${section.title}  (\`${section.issueId}\`)`);
    lines.push(`- **OBSERVADO (web)**: ${section.observedEvidence}`);
    if (section.repositoryFiles.length > 0) {
      lines.push(
        `- **OBSERVADO (repo)**: ${section.repositoryFiles
          .map((file) => `\`${file}\``)
          .join(", ")}`,
      );
    }
    lines.push(`- **INFERENCIA**: ${section.inference}`);
    lines.push(`- **RECOMENDACIÓN**: ${section.recommendation}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function buildInference(issue: SeoIssueView, files: readonly string[]): string {
  if (files.length === 0) {
    return `El hallazgo no se ha podido asociar a ningún archivo concreto del repositorio.`;
  }
  return `El hallazgo "${issue.title}" se ha observado en la web y los archivos ${files
    .map((file) => `\`${file}\``)
    .join(", ")} son los candidatos más probables del repositorio donde se origina el marcado correspondiente.`;
}

function buildRecommendation(
  issue: SeoIssueView,
  files: readonly string[],
  audit: SeoAuditLite,
): string {
  const fileList = files.map((file) => `\`${file}\``).join(", ");
  switch (issue.id) {
    case "missing-title":
      return `Añadir/rellenar la etiqueta <title> en ${fileList} con un texto descriptivo único por página (≤ 60 caracteres).`;
    case "missing-description":
      return `Añadir/rellenar la meta description en ${fileList} con un resumen que invite al clic (≤ 160 caracteres).`;
    case "missing-canonical":
      return `Establecer <link rel="canonical" href="…"> en ${fileList} apuntando a la URL canónica de la página.`;
    case "long-title":
      return `Recortar el title actual ("${audit.page.title.slice(0, 60)}…", ${audit.page.title.length} caracteres) en ${fileList} para que no se trunque en las SERPs.`;
    case "missing-h1":
      return `Añadir un único encabezado H1 en ${fileList} que describa la propuesta de valor principal de la página.`;
    case "multiple-h1":
      return `Reducir a un único H1 en ${fileList}; los demás deben ser H2/H3 según la jerarquía del contenido.`;
    case "noindex":
      return `Quitar la directiva noindex de ${fileList} (o dejarla solo en páginas que NO deben indexarse) para que los buscadores indexen la página.`;
    case "broken-links":
      return `Corregir los enlaces rotos detectados en ${fileList} para que la navegación y el rastreo no se rompan.`;
    case "images-without-alt":
      return `Añadir atributo alt descriptivo en cada <img> de ${fileList}.`;
    case "missing-sitemap":
      return `Generar o exponer ${fileList} en la raíz del sitio; los buscadores lo necesitan para descubrir todas las URLs.`;
    case "structured-data": {
      const blocks = audit.page.structuredDataBlocks;
      return `Añadir JSON-LD (Schema.org) en ${fileList} para los tipos principales (Organization, WebSite, BreadcrumbList). Detectados actualmente: ${blocks} bloques.`;
    }
    default:
      return `Revisar ${fileList} para corregir "${issue.title}" (impacto: ${issue.impact}).`;
  }
}

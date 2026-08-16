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
    /(^|\/)(layout|page|index|head|metadata|seo|robots|sitemap|next\.config|vite\.config)[^/]*\.(tsx?|jsx?|vue|html|js|json)$/i.test(path),
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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
import type {
  ConnectorExecutionRequest,
  ConnectorExecutionResult,
  ConnectorHealthResult,
  ConnectorRuntime,
} from "@departify/connector-runtime";

export type MarketingConnectorProvider = "wordpress" | "shopify";

export interface WordPressCredentials {
  readonly provider: "wordpress";
  readonly websiteUrl: string;
  readonly username: string;
  readonly password: string;
}

export interface ShopifyCredentials {
  readonly provider: "shopify";
  readonly shopName: string;
  readonly adminToken: string;
  readonly apiVersion: string;
}

export type MarketingConnectorCredentials = WordPressCredentials | ShopifyCredentials;

export interface MarketingConnectorRecord {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: MarketingConnectorProvider;
  readonly credentials: MarketingConnectorCredentials;
  readonly accountLabel: string;
  readonly verifiedAt: string | null;
  readonly lastError: string | null;
}

export interface MarketingConnectorStore {
  get(organizationId: string, userId: string, provider: MarketingConnectorProvider): Promise<MarketingConnectorRecord | null>;
  put(record: MarketingConnectorRecord): Promise<void>;
  remove(organizationId: string, userId: string, provider: MarketingConnectorProvider): Promise<boolean>;
}

export class InMemoryMarketingConnectorStore implements MarketingConnectorStore {
  private readonly records = new Map<string, MarketingConnectorRecord>();

  private key(organizationId: string, userId: string, provider: MarketingConnectorProvider): string {
    return `${organizationId}:${userId}:${provider}`;
  }

  async get(organizationId: string, userId: string, provider: MarketingConnectorProvider): Promise<MarketingConnectorRecord | null> {
    return this.records.get(this.key(organizationId, userId, provider)) ?? null;
  }

  async put(record: MarketingConnectorRecord): Promise<void> {
    this.records.set(this.key(record.organizationId, record.userId, record.provider), record);
  }

  async remove(organizationId: string, userId: string, provider: MarketingConnectorProvider): Promise<boolean> {
    return this.records.delete(this.key(organizationId, userId, provider));
  }
}

interface MarketingConnectorRow {
  organization_id: string;
  user_id: string;
  provider: MarketingConnectorProvider;
  credentials: MarketingConnectorCredentials;
  account_label: string;
  verified_at: string | null;
  last_error: string | null;
}

/** Service-role-only. Raw credentials never belong in portal/tool-state rows. */
export class SupabaseMarketingConnectorStore implements MarketingConnectorStore {
  private readonly admin: SupabaseClient;

  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }

  async get(organizationId: string, userId: string, provider: MarketingConnectorProvider): Promise<MarketingConnectorRecord | null> {
    const { data, error } = await this.admin
      .from("marketing_connector_credentials")
      .select("organization_id,user_id,provider,credentials,account_label,verified_at,last_error")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRow(data as MarketingConnectorRow) : null;
  }

  async put(record: MarketingConnectorRecord): Promise<void> {
    const { error } = await this.admin.from("marketing_connector_credentials").upsert({
      organization_id: record.organizationId,
      user_id: record.userId,
      provider: record.provider,
      credentials: record.credentials,
      account_label: record.accountLabel,
      verified_at: record.verifiedAt,
      last_error: record.lastError,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id,user_id,provider" });
    if (error) throw error;
  }

  async remove(organizationId: string, userId: string, provider: MarketingConnectorProvider): Promise<boolean> {
    const { data, error } = await this.admin
      .from("marketing_connector_credentials")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .eq("provider", provider)
      .select("provider");
    if (error) throw error;
    return Boolean(data?.length);
  }
}

function mapRow(row: MarketingConnectorRow): MarketingConnectorRecord {
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    provider: row.provider,
    credentials: row.credentials,
    accountLabel: row.account_label,
    verifiedAt: row.verified_at,
    lastError: row.last_error,
  };
}

let marketingConnectorStore: MarketingConnectorStore = new InMemoryMarketingConnectorStore();

export function getMarketingConnectorStore(): MarketingConnectorStore {
  return marketingConnectorStore;
}

export function setMarketingConnectorStore(store: MarketingConnectorStore): void {
  marketingConnectorStore = store;
}

export interface MarketingCapabilityDefinition {
  readonly id: string;
  readonly provider: MarketingConnectorProvider;
  readonly providerToolId: "wordpress" | "shopify";
  readonly sideEffect: boolean;
}

export const MARKETING_CONNECTOR_CAPABILITIES: readonly MarketingCapabilityDefinition[] = [
  { id: "marketing.wordpress.connection.test", provider: "wordpress", providerToolId: "wordpress", sideEffect: false },
  { id: "marketing.wordpress.site.read", provider: "wordpress", providerToolId: "wordpress", sideEffect: false },
  { id: "marketing.wordpress.posts.list", provider: "wordpress", providerToolId: "wordpress", sideEffect: false },
  { id: "marketing.wordpress.posts.get", provider: "wordpress", providerToolId: "wordpress", sideEffect: false },
  { id: "marketing.wordpress.posts.create", provider: "wordpress", providerToolId: "wordpress", sideEffect: true },
  { id: "marketing.wordpress.posts.update", provider: "wordpress", providerToolId: "wordpress", sideEffect: true },
  { id: "marketing.wordpress.categories.list", provider: "wordpress", providerToolId: "wordpress", sideEffect: false },
  { id: "marketing.wordpress.tags.list", provider: "wordpress", providerToolId: "wordpress", sideEffect: false },
  { id: "marketing.shopify.connection.test", provider: "shopify", providerToolId: "shopify", sideEffect: false },
  { id: "marketing.shopify.shop.read", provider: "shopify", providerToolId: "shopify", sideEffect: false },
  { id: "marketing.shopify.products.list", provider: "shopify", providerToolId: "shopify", sideEffect: false },
  { id: "marketing.shopify.products.get", provider: "shopify", providerToolId: "shopify", sideEffect: false },
  { id: "marketing.shopify.products.create", provider: "shopify", providerToolId: "shopify", sideEffect: true },
  { id: "marketing.shopify.products.update", provider: "shopify", providerToolId: "shopify", sideEffect: true },
  { id: "marketing.shopify.orders.list", provider: "shopify", providerToolId: "shopify", sideEffect: false },
  { id: "marketing.shopify.orders.get", provider: "shopify", providerToolId: "shopify", sideEffect: false },
  { id: "marketing.shopify.customers.list", provider: "shopify", providerToolId: "shopify", sideEffect: false },
];

export function getMarketingConnectorCapability(id: string): MarketingCapabilityDefinition | null {
  return MARKETING_CONNECTOR_CAPABILITIES.find((capability) => capability.id === id) ?? null;
}

/**
 * Resolve a CEO's operational Marketing request to a registered capability.
 * The resolver is intentionally registry-backed: provider actions are never
 * invented in the conversational route and only capabilities declared above
 * can reach the connector runtime.
 */
export function resolveMarketingConnectorCapability(message: string): MarketingCapabilityDefinition | null {
  const value = message.toLocaleLowerCase();
  const asksWordPress = /wordpress|wp\b|publicaci[oó]n|\bpost\b|categor[ií]a|etiqueta/.test(value);
  const asksShopify = /shopify|producto|pedido|orden|cliente|tienda/.test(value);

  if (asksWordPress) {
    if (/categor[ií]a/.test(value)) return getMarketingConnectorCapability("marketing.wordpress.categories.list");
    if (/etiqueta/.test(value)) return getMarketingConnectorCapability("marketing.wordpress.tags.list");
    if (/(crear|crea|nuevo|redacta|publicar|publica)/.test(value) && /publicaci[oó]n|\bpost\b|entrada/.test(value)) return getMarketingConnectorCapability("marketing.wordpress.posts.create");
    if (/(actualiza|actualizar|edita|editar|modifica)/.test(value) && /publicaci[oó]n|\bpost\b|entrada/.test(value)) return getMarketingConnectorCapability("marketing.wordpress.posts.update");
    if (/sitio|web|p[aá]gina principal/.test(value) && !/publicaci[oó]n|\bpost\b/.test(value)) return getMarketingConnectorCapability("marketing.wordpress.site.read");
    return getMarketingConnectorCapability("marketing.wordpress.posts.list");
  }

  if (asksShopify) {
    if (/cliente/.test(value)) return getMarketingConnectorCapability("marketing.shopify.customers.list");
    if (/pedido|orden/.test(value)) return /\b(id|n[uú]mero)\b|detalle/.test(value)
      ? getMarketingConnectorCapability("marketing.shopify.orders.get")
      : getMarketingConnectorCapability("marketing.shopify.orders.list");
    if (/(crear|crea|nuevo|a[nñ]ade|a[ñn]adir)/.test(value) && /producto/.test(value)) return getMarketingConnectorCapability("marketing.shopify.products.create");
    if (/(actualiza|actualizar|edita|editar|modifica)/.test(value) && /producto/.test(value)) return getMarketingConnectorCapability("marketing.shopify.products.update");
    if (/tienda|shop/.test(value) && !/producto/.test(value)) return getMarketingConnectorCapability("marketing.shopify.shop.read");
    return /\b(id|n[uú]mero)\b|detalle/.test(value)
      ? getMarketingConnectorCapability("marketing.shopify.products.get")
      : getMarketingConnectorCapability("marketing.shopify.products.list");
  }

  return null;
}

export function capabilitiesForMarketingProvider(provider: MarketingConnectorProvider): readonly string[] {
  return MARKETING_CONNECTOR_CAPABILITIES
    .filter((capability) => capability.provider === provider && !capability.id.endsWith("connection.test"))
    .map((capability) => capability.id);
}

export function accountLabelForCredentials(credentials: MarketingConnectorCredentials): string {
  return credentials.provider === "wordpress"
    ? new URL(credentials.websiteUrl).hostname
    : `${credentials.shopName}.myshopify.com`;
}

export function apiVersionForShopify(): string {
  return process.env.SHOPIFY_API_VERSION?.trim() || "2026-07";
}

export interface MarketingProbeResult {
  readonly operational: boolean;
  readonly accountLabel: string;
  readonly error: string | null;
}

/**
 * Provider errors stay in server logs/store for diagnostics, but the portal
 * receives business-safe copy. In particular, never expose HTTP status text,
 * response bodies, or credential-shaped values to the customer.
 */
export function humanizeMarketingConnectorError(
  provider: MarketingConnectorProvider,
  error: string | null | undefined,
): string {
  const value = (error ?? "").toLocaleLowerCase();
  if (/401|403|unauthori[sz]ed|forbidden|invalid token|authentication/.test(value)) {
    return provider === "wordpress"
      ? "No hemos podido validar esta credencial. Comprueba que el usuario tenga permisos y que has usado una contraseña de aplicación completa."
      : "No hemos podido validar esta credencial. Comprueba el nombre de la tienda, el token y los permisos de la app.";
  }
  return "No hemos podido validar esta credencial. Comprueba que la has copiado completa y vuelve a intentarlo.";
}

export async function probeMarketingCredentials(
  credentials: MarketingConnectorCredentials,
  signal?: AbortSignal,
): Promise<MarketingProbeResult> {
  try {
    if (credentials.provider === "wordpress") {
      const response = await wordpressRequest(credentials, "users/me", { method: "GET" }, signal);
      if (!response.ok) return { operational: false, accountLabel: accountLabelForCredentials(credentials), error: safeProviderError(response.status, await response.text()) };
    } else {
      const response = await shopifyRequest(credentials, "shop.json", { method: "GET" }, signal);
      if (!response.ok) return { operational: false, accountLabel: accountLabelForCredentials(credentials), error: safeProviderError(response.status, await response.text()) };
    }
    return { operational: true, accountLabel: accountLabelForCredentials(credentials), error: null };
  } catch (cause) {
    return { operational: false, accountLabel: accountLabelForCredentials(credentials), error: safeThrownError(cause) };
  }
}

/**
 * Provider-neutral runtime. Activepieces remains the source of connector
 * action definitions; this runtime is the safe execution path until a
 * Departify-owned Activepieces flow binding exists for each tenant.
 */
export class MarketingConnectorRuntime implements ConnectorRuntime {
  readonly provider = "departify_marketing" as const;

  async health(signal?: AbortSignal): Promise<ConnectorHealthResult> {
    return { provider: this.provider, healthy: true, status: 200, durationMs: 0, ...(signal?.aborted ? { error: "cancelled" } : {}) };
  }

  async execute<TOutput = unknown>(request: ConnectorExecutionRequest, signal?: AbortSignal): Promise<ConnectorExecutionResult<TOutput>> {
    const started = new Date();
    const capability = getMarketingConnectorCapability(request.capability);
    const finish = (result: Omit<ConnectorExecutionResult<TOutput>, "requestId" | "organizationId" | "provider" | "capability" | "operation" | "durationMs" | "startedAt" | "completedAt">): ConnectorExecutionResult<TOutput> => {
      const completed = new Date();
      return {
        requestId: request.requestId,
        organizationId: request.organizationId,
        provider: this.provider,
        capability: request.capability,
        operation: request.operation,
        ...result,
        durationMs: completed.getTime() - started.getTime(),
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
      };
    };

    if (!capability) return finish({ status: "failed", error: { code: "invalid_request", message: "Marketing capability is not registered.", retryable: false } });
    if (request.operation === "prepare") return finish({ status: "prepared", output: { capability: request.capability, sideEffect: capability.sideEffect } as TOutput });
    if (signal?.aborted) return finish({ status: "cancelled", error: { code: "cancelled", message: "The connector request was cancelled.", retryable: false } });

    const userId = request.userId ?? request.organizationId;
    const record = await getMarketingConnectorStore().get(request.organizationId, userId, capability.provider);
    if (!record || !record.verifiedAt) return finish({ status: "credential_required", error: { code: "credential_required", message: "This marketing connection must be verified first.", retryable: false } });

    try {
      const output = await executeMarketingCapability(capability.id, record.credentials, request.input, signal);
      return finish({ status: "succeeded", output: output as TOutput });
    } catch (cause) {
      return finish({ status: "failed", error: { code: "provider_unavailable", message: safeThrownError(cause), retryable: true } });
    }
  }
}

async function executeMarketingCapability(
  capability: string,
  credentials: MarketingConnectorCredentials,
  input: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown> {
  if (credentials.provider === "wordpress") {
    if (capability === "marketing.wordpress.connection.test") return { ...(await probeMarketingCredentials(credentials, signal)), provider: "wordpress" };
    if (capability === "marketing.wordpress.site.read") return normalizeWordPressSite(await wordpressRootJson(credentials, "", { method: "GET" }, signal));
    const id = positiveId(input.id);
    if (capability === "marketing.wordpress.posts.list") return normalizeWordPressPosts(await wordpressJson(credentials, "posts?per_page=50&_fields=id,date,link,status,title", { method: "GET" }, signal));
    if (capability === "marketing.wordpress.posts.get" && id) return normalizeWordPressPost(await wordpressJson(credentials, `posts/${id}`, { method: "GET" }, signal));
    if (capability === "marketing.wordpress.posts.create") {
      return normalizeWordPressPost(await wordpressJson(credentials, "posts", { method: "POST", body: JSON.stringify({ title: requiredText(input.title, "title"), content: requiredText(input.content, "content"), status: text(input.status) || "draft" }) }, signal));
    }
    if (capability === "marketing.wordpress.posts.update" && id) {
      const body: Record<string, string> = {};
      for (const key of ["title", "content", "status"] as const) if (text(input[key])) body[key] = text(input[key])!;
      return normalizeWordPressPost(await wordpressJson(credentials, `posts/${id}`, { method: "POST", body: JSON.stringify(body) }, signal));
    }
    if (capability === "marketing.wordpress.categories.list") return normalizeWordPressTerms(await wordpressJson(credentials, "categories?per_page=100&_fields=id,name,slug,count", { method: "GET" }, signal));
    if (capability === "marketing.wordpress.tags.list") return normalizeWordPressTerms(await wordpressJson(credentials, "tags?per_page=100&_fields=id,name,slug,count", { method: "GET" }, signal));
    throw new Error("A WordPress post id is required for this operation.");
  }

  if (capability === "marketing.shopify.connection.test") return { ...(await probeMarketingCredentials(credentials, signal)), provider: "shopify" };
  const id = positiveId(input.id);
  if (capability === "marketing.shopify.shop.read") return normalizeShop(await shopifyJson(credentials, "shop.json", { method: "GET" }, signal));
  if (capability === "marketing.shopify.products.list") return normalizeShopifyCollection(await shopifyJson(credentials, "products.json?limit=50&fields=id,title,status,updated_at", { method: "GET" }, signal), "products");
  if (capability === "marketing.shopify.products.get" && id) return normalizeShopifyItem(await shopifyJson(credentials, `products/${id}.json`, { method: "GET" }, signal), "product");
  if (capability === "marketing.shopify.products.create") {
    return normalizeShopifyItem(await shopifyJson(credentials, "products.json", { method: "POST", body: JSON.stringify({ product: { title: requiredText(input.title, "title"), body_html: text(input.content) || "", status: text(input.status) || "draft" } }) }, signal), "product");
  }
  if (capability === "marketing.shopify.products.update" && id) {
    const product: Record<string, string> = {};
    for (const key of ["title", "content", "status"] as const) if (text(input[key])) product[key === "content" ? "body_html" : key] = text(input[key])!;
    return normalizeShopifyItem(await shopifyJson(credentials, `products/${id}.json`, { method: "PUT", body: JSON.stringify({ product }) }, signal), "product");
  }
  if (capability === "marketing.shopify.orders.list") return normalizeShopifyCollection(await shopifyJson(credentials, "orders.json?status=any&limit=50&fields=id,name,created_at,financial_status,fulfillment_status,total_price", { method: "GET" }, signal), "orders");
  if (capability === "marketing.shopify.orders.get" && id) return normalizeShopifyItem(await shopifyJson(credentials, `orders/${id}.json`, { method: "GET" }, signal), "order");
  if (capability === "marketing.shopify.customers.list") return normalizeShopifyCollection(await shopifyJson(credentials, "customers.json?limit=50&fields=id,email,first_name,last_name,orders_count,total_spent", { method: "GET" }, signal), "customers");
  throw new Error("A Shopify resource id is required for this operation.");
}

async function wordpressRequest(credentials: WordPressCredentials, path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const base = credentials.websiteUrl.replace(/\/+$/, "");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  return fetchWithConnectorTimeout(`${base}/wp-json/wp/v2/${path}`, { ...init, headers }, signal);
}

async function wordpressRootRequest(credentials: WordPressCredentials, path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const base = credentials.websiteUrl.replace(/\/+$/, "");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  return fetchWithConnectorTimeout(`${base}/wp-json${path ? `/${path.replace(/^\/+/, "")}` : ""}`, { ...init, headers }, signal);
}

async function shopifyRequest(credentials: ShopifyCredentials, path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const shop = credentials.shopName.replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.myshopify\.com$/, "");
  const headers = new Headers(init.headers);
  headers.set("X-Shopify-Access-Token", credentials.adminToken);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  return fetchWithConnectorTimeout(`https://${shop}.myshopify.com/admin/api/${credentials.apiVersion}/${path}`, { ...init, headers }, signal);
}

async function fetchWithConnectorTimeout(url: string, init: RequestInit, externalSignal?: AbortSignal): Promise<Response> {
  const timeoutMs = Number.parseInt(process.env.MARKETING_CONNECTOR_TIMEOUT_MS ?? process.env.ACTIVEPIECES_CONNECTOR_TIMEOUT_MS ?? "60000", 10);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 60_000);
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) controller.abort(externalSignal.reason);
  else externalSignal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

async function wordpressJson(credentials: WordPressCredentials, path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const response = await wordpressRequest(credentials, path, init, signal);
  const body = await response.text();
  if (!response.ok) throw new Error(safeProviderError(response.status, body));
  return parseJson(body);
}

async function wordpressRootJson(credentials: WordPressCredentials, path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const response = await wordpressRootRequest(credentials, path, init, signal);
  const body = await response.text();
  if (!response.ok) throw new Error(safeProviderError(response.status, body));
  return parseJson(body);
}

async function shopifyJson(credentials: ShopifyCredentials, path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const response = await shopifyRequest(credentials, path, init, signal);
  const body = await response.text();
  if (!response.ok) throw new Error(safeProviderError(response.status, body));
  return parseJson(body);
}

function normalizeWordPressPost(value: unknown): unknown {
  const post = value as Record<string, unknown>;
  return { id: post.id, date: post.date, link: post.link, status: post.status, title: ((post.title as Record<string, unknown> | undefined)?.rendered ?? "") };
}

function normalizeWordPressPosts(value: unknown): unknown {
  return Array.isArray(value) ? value.map(normalizeWordPressPost) : [];
}

function normalizeWordPressTerms(value: unknown): unknown {
  return Array.isArray(value) ? value.map((term) => {
    const item = term as Record<string, unknown>;
    return { id: item.id, name: item.name, slug: item.slug, count: item.count };
  }) : [];
}

function normalizeWordPressSite(value: unknown): unknown {
  const site = value as Record<string, unknown>;
  return { name: site.name, description: site.description, url: site.url, home: site.home, namespaces: site.namespaces };
}

function normalizeShop(value: unknown): unknown {
  const shop = (value as Record<string, unknown>).shop as Record<string, unknown> | undefined;
  return shop ? { id: shop.id, name: shop.name, domain: shop.domain, myshopifyDomain: shop.myshopify_domain, currency: shop.currency, plan: shop.plan_name } : {};
}

function normalizeShopifyItem(value: unknown, key: string): unknown {
  const item = (value as Record<string, unknown>)[key] as Record<string, unknown> | undefined;
  return item ? {
    id: item.id,
    title: item.title,
    name: item.name,
    status: item.status,
    updatedAt: item.updated_at,
    createdAt: item.created_at,
    totalPrice: item.total_price,
    financialStatus: item.financial_status,
    fulfillmentStatus: item.fulfillment_status,
    email: item.email,
    firstName: item.first_name,
    lastName: item.last_name,
    ordersCount: item.orders_count,
    totalSpent: item.total_spent,
  } : {};
}

function normalizeShopifyCollection(value: unknown, key: string): unknown {
  const items = (value as Record<string, unknown>)[key];
  return Array.isArray(items) ? items.map((item) => normalizeShopifyItem({ [key.slice(0, -1)]: item }, key.slice(0, -1))) : [];
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { throw new Error("The provider returned an invalid response."); }
}

function positiveId(value: unknown): string | null {
  const candidate = text(value);
  return candidate && /^[0-9]+$/.test(candidate) ? candidate : null;
}

function requiredText(value: unknown, field: string): string {
  const candidate = text(value);
  if (!candidate) throw new Error(`A ${field} is required.`);
  return candidate;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeProviderError(status: number, body: string): string {
  const compact = body
    .replace(/[\r\n]+/g, " ")
    .replace(/(x-shopify-access-token|access_token|token|password|secret|authorization|cookie)\s*[:=]\s*[^ ,}]+/gi, "$1=[redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic [redacted]")
    .slice(0, 240);
  return `Provider returned HTTP ${status}${compact ? `: ${compact}` : "."}`;
}

function safeThrownError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "Provider request failed.";
  return message
    .replace(/[\r\n]+/g, " ")
    .replace(/(x-shopify-access-token|access_token|token|password|secret|authorization|cookie)\s*[:=]\s*[^ ,}]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

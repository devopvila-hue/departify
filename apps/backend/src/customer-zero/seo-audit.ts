export type SeoIssuePriority = "critical" | "important" | "opportunity";

export interface SeoIssue {
  readonly id: string;
  readonly priority: SeoIssuePriority;
  readonly title: string;
  readonly impact: string;
  readonly evidence: string;
}

export interface SeoAuditReport {
  readonly url: string;
  readonly fetchedAt: string;
  readonly page: {
    readonly title: string;
    readonly description: string;
    readonly canonical: string | null;
    readonly robots: string | null;
    readonly headings: Readonly<Record<"h1" | "h2" | "h3", readonly string[]>>;
    readonly internalUrls: readonly string[];
    readonly brokenUrls: readonly string[];
    readonly imagesWithoutAlt: number;
    readonly structuredDataBlocks: number;
    readonly socialMetadata: readonly string[];
    readonly sitemap: "available" | "missing" | "unavailable";
  };
  readonly issues: readonly SeoIssue[];
  readonly source: "website";
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 700_000;
const MAX_LINK_CHECKS = 20;

function text(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function first(html: string, regex: RegExp): string {
  return (regex.exec(html)?.[1] ?? "").trim();
}

function all(html: string, regex: RegExp): string[] {
  const result: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) result.push(match[1] ?? match[0]);
  return result;
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag);
  return match?.[1]?.trim() || null;
}

async function fetchText(url: string): Promise<{ status: number; contentType: string; body: string }> {
  const response = await fetch(url, {
    headers: { "user-agent": "DepartifySeoAudit/1.0", accept: "text/html,application/xml,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const bytes = await response.arrayBuffer();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    body: new TextDecoder().decode(bytes).slice(0, MAX_BYTES),
  };
}

function addIssue(issues: SeoIssue[], priority: SeoIssuePriority, id: string, title: string, impact: string, evidence: string): void {
  issues.push({ id, priority, title, impact, evidence });
}

export async function auditWebsite(url: string): Promise<SeoAuditReport> {
  const parsedUrl = new URL(url);
  if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error("La web debe usar http o https.");
  const pageResponse = await fetchText(parsedUrl.toString());
  if (pageResponse.status < 200 || pageResponse.status >= 400 || !pageResponse.contentType.includes("html")) {
    throw new Error("No hemos podido leer la web de tu empresa.");
  }
  const html = pageResponse.body;
  const title = text(first(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = first(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i);
  const canonical = first(html, /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i) || null;
  const robots = first(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i) || null;
  const headings = {
    h1: all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(text),
    h2: all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(text),
    h3: all(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).map(text),
  } as const;
  const issues: SeoIssue[] = [];
  if (!title) addIssue(issues, "critical", "missing-title", "La página no tiene title", "Los buscadores y el usuario no reciben un título claro.", "No se encontró la etiqueta title.");
  if (title.length > 60) addIssue(issues, "opportunity", "long-title", "El title es demasiado largo", "Puede truncarse en los resultados de búsqueda.", `${title.length} caracteres detectados.`);
  if (!description) addIssue(issues, "important", "missing-description", "Falta la meta description", "La página pierde control sobre el resumen mostrado en buscadores.", "No se encontró una meta description.");
  if (!canonical) addIssue(issues, "important", "missing-canonical", "Falta la URL canonical", "Puede haber señales ambiguas si la página tiene varias URLs.", "No se encontró un enlace canonical.");
  if (headings.h1.length === 0) addIssue(issues, "important", "missing-h1", "Falta el encabezado principal", "La página no comunica una jerarquía principal clara.", "No se encontró ningún H1.");
  if (headings.h1.length > 1) addIssue(issues, "opportunity", "multiple-h1", "Hay varios H1", "Conviene revisar la jerarquía para que exista un encabezado principal inequívoco.", `${headings.h1.length} H1 detectados.`);
  if (robots?.toLowerCase().includes("noindex")) addIssue(issues, "critical", "noindex", "La página indica noindex", "Los buscadores no deberían indexarla mientras esta directiva exista.", `robots: ${robots}`);

  const links = all(html, /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi);
  const internalUrls = [...new Set(links.map((href) => {
    try { return new URL(href, parsedUrl).toString(); } catch { return ""; }
  }).filter((href) => href.startsWith(`${parsedUrl.protocol}//${parsedUrl.host}`)))].slice(0, MAX_LINK_CHECKS);
  const brokenUrls: string[] = [];
  for (const link of internalUrls) {
    try {
      const result = await fetchText(link);
      if (result.status >= 400) brokenUrls.push(link);
    } catch {
      brokenUrls.push(link);
    }
  }
  if (brokenUrls.length > 0) addIssue(issues, "important", "broken-links", "Hay enlaces internos que no responden", "Algunas rutas pueden estar rompiendo la navegación y la exploración del sitio.", `${brokenUrls.length} enlaces comprobados con error.`);

  const imagesWithoutAlt = all(html, /<img\b[^>]*>/gi).filter((tag) => attr(tag, "alt") === null).length;
  if (imagesWithoutAlt > 0) addIssue(issues, "opportunity", "images-without-alt", "Hay imágenes sin alt", "Se pierde contexto para accesibilidad y comprensión de imágenes.", `${imagesWithoutAlt} imágenes sin atributo alt.`);
  const structuredDataBlocks = all(html, /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi).length;
  const socialMetadata = ["og:title", "og:description", "og:image", "twitter:card"].filter((property) => new RegExp(`(?:property|name)=["']${property}["']`, "i").test(html));
  const sitemapUrl = new URL("/sitemap.xml", parsedUrl).toString();
  let sitemap: SeoAuditReport["page"]["sitemap"] = "unavailable";
  try {
    const sitemapResponse = await fetchText(sitemapUrl);
    sitemap = sitemapResponse.status >= 200 && sitemapResponse.status < 400 ? "available" : "missing";
  } catch {
    sitemap = "unavailable";
  }
  if (sitemap === "missing") addIssue(issues, "important", "missing-sitemap", "No se encontró sitemap.xml", "El descubrimiento de URLs puede ser menos directo para los buscadores.", sitemapUrl);

  return {
    url: parsedUrl.toString(),
    fetchedAt: new Date().toISOString(),
    page: { title, description, canonical, robots, headings, internalUrls, brokenUrls, imagesWithoutAlt, structuredDataBlocks, socialMetadata, sitemap },
    issues,
    source: "website",
  };
}

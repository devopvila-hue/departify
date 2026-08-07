/**
 * URL normalization for the Customer Zero onboarding.
 *
 * The CEO must never be forced to type a protocol. `moonsharedliving.com`,
 * `www.moonsharedliving.com`, `http://…` and `https://…` are all accepted and
 * normalized to a canonical absolute https/http URL before validation.
 */

export interface NormalizedUrl {
  /** The canonical absolute URL used for the real web fetch. */
  readonly url: string;
  /** The hostname, used for slugs and display. */
  readonly hostname: string;
}

export class InvalidCompanyUrlError extends Error {
  constructor(input: string) {
    super(`'${input}' no parece una dirección web válida.`);
    this.name = "InvalidCompanyUrlError";
  }
}

const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Normalizes user-typed website input. Returns the canonical URL or throws
 * `InvalidCompanyUrlError` when the input cannot be a website.
 */
export function normalizeCompanyUrl(input: string): NormalizedUrl {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (trimmed.length === 0) {
    throw new InvalidCompanyUrlError(input);
  }

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new InvalidCompanyUrlError(input);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new InvalidCompanyUrlError(input);
  }
  if (!HOSTNAME_PATTERN.test(parsed.hostname)) {
    throw new InvalidCompanyUrlError(input);
  }

  // Drop a trailing slash on the bare root for a stable canonical form.
  const canonical =
    parsed.pathname === "/" && !parsed.search && !parsed.hash
      ? `${parsed.protocol}//${parsed.host}`
      : parsed.toString();

  return { url: canonical, hostname: parsed.hostname };
}

/** Non-throwing variant used by callers that want to branch on validity. */
export function tryNormalizeCompanyUrl(input: string): NormalizedUrl | null {
  try {
    return normalizeCompanyUrl(input);
  } catch {
    return null;
  }
}

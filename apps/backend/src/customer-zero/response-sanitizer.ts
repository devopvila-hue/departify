/**
 * Sprint 68 — Centralized Response Sanitization
 *
 * Single boundary for all CEO-facing responses. Ensures no internal
 * infrastructure details (OpenClaw, gateway, MCP, model names, etc.)
 * leak into the final response.
 *
 * This module consolidates sanitization logic previously scattered
 * across customer-zero-v2.ts and department-work.ts.
 */

// ─── Forbidden Terms ─────────────────────────────────────────────────

/** Terms that must never appear in CEO-facing responses. */
const FORBIDDEN_TERMS = [
  "openclaw",
  "gateway",
  "compaction",
  "/compact",
  "/new",
  "reservetokensfloor",
  "agents.defaults",
  "context window",
  "token limit",
  "mcp",
  "model:",
  "provider:",
  "runtime",
  "adapter",
  "websocket",
  "json-rpc",
  "ed25519",
  "session id",
  "agent id",
  "tool call",
  "departify_tool_call",
] as const;

/** Structural patterns that indicate internal leaks. */
const LEAK_PATTERNS = [
  /\/compact\b/i,
  /\/new\b/i,
  /agents\.defaults/i,
  /reservetokensfloor/i,
  /\bmodel\s*[:=]\s*\w+/i,
  /\bprovider\s*[:=]\s*\w+/i,
  /\bsession\s*id\s*[:=]\s*\w+/i,
  /\bagent\s*id\s*[:=]\s*\w+/i,
] as const;

/** Known engine error strings. */
const ENGINE_ERROR_PATTERNS = [
  /agent\s+run\s+failed/i,
  /agent\s+failed\s+to\s+respond/i,
  /engine\s+completed\s+without\s+returning/i,
  /el\s+motor\s+no\s+devolvió/i,
  /el\s+motor\s+falló/i,
  /el\s+motor\s+terminó\s+sin\s+devolver/i,
  /el\s+motor\s+de\s+negocio\s+ha\s+fallado/i,
  /no\s+he\s+podido\s+completar\s+esa\s+respuesta\s+porque\s+el\s+motor/i,
  /i\s+couldn't\s+complete\s+that\s+response\s+because\s+the\s+business\s+engine\s+failed/i,
  /engine\s+error/i,
  /runtime\s+error/i,
  /openclaw\s+error/i,
  /gateway\s+error/i,
] as const;

/** Patterns that indicate hallucinated progress claims. */
const UNBACKED_WORK_PATTERNS = [
  /\blo\s+estoy\s+(haciendo|extrayendo|generando|preparando|analizando|trabajando)\b/i,
  /\b(?:extrayendo|aplicando\s+el\s+scoring|generando\s+el\s+gr[aá]fico|generando\s+el\s+dashboard)\b/i,
  /\bdame\s+unos\s+minutos\b/i,
  /\bte\s+lo\s+(?:entrego|dejo)\s+(?:en\s+)?(?:unos\s+minutos|resultados)\b/i,
  /\b(?:estar[aá]|est[aá])\s+(?:disponible|listo|colgado)\b/i,
  /\by[aá]\s+estoy\s+trabajando\s+en\s+ello\b/i,
] as const;

/** Patterns that indicate unsupported promises. */
const UNSUPPORTED_PROMISE_PATTERNS = [
  /\bte\s+(lo\s+)?(traigo|presento|envío|aviso|mando)\s+(luego|ahora|en\s+un\s+momento|mañana|después)\b/i,
  /\blo\s+(dejo|dejare|dejaré|dejamos)\s+(en\s+resultados|en\s+actividades|listo|fijado|en\s+la\s+secci[oó]n)\b/i,
  /\bte\s+(confirmo|avisar[ée]|informaré|notificar[ée]|escribo|escribimos)\s+cuando\b/i,
  /\bte\s+aviso\s+(cuando|en\s+cuanto)\b/i,
  /\bte\s+(lo\s+)?(traigo|presento|mando)\s+en\s+cuanto\b/i,
  /\blo\s+(dejo|dejare|dejaré)\s+fijado\b/i,
] as const;

// ─── Detection Functions ─────────────────────────────────────────────

/**
 * Detect internal runtime leaks in text. Returns true if the text
 * contains forbidden infrastructure terms.
 *
 * Requires 2+ distinct hits OR a structural pattern to avoid
 * false positives (e.g., "open" in a business context).
 */
export function isInternalRuntimeLeak(text: string): boolean {
  const lower = text.toLowerCase();
  const hits = new Set<string>();

  for (const term of FORBIDDEN_TERMS) {
    if (lower.includes(term)) {
      hits.add(term);
    }
  }

  // Structural patterns are always a leak
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return hits.size >= 2;
}

/**
 * Detect known engine error strings in text.
 */
export function isEngineErrorText(text: string): boolean {
  return ENGINE_ERROR_PATTERNS.some((p) => p.test(text));
}

/**
 * Detect hallucinated progress claims in text.
 */
export function detectUnbackedWorkClaim(text: string): boolean {
  return UNBACKED_WORK_PATTERNS.some((p) => p.test(text));
}

/**
 * Detect unsupported promises in text.
 */
export function detectUnsupportedPromise(text: string): boolean {
  return UNSUPPORTED_PROMISE_PATTERNS.some((p) => p.test(text));
}

// ─── Sanitization Functions ──────────────────────────────────────────

/**
 * Strip `<departify_tool_call>` XML blocks from text.
 */
export function stripToolCallTags(text: string): string {
  return text.replace(/<departify_tool_call>[\s\S]*?<\/departify_tool_call>/gi, "").trim();
}

/**
 * Safe fallback message when the engine response is unusable.
 */
export function safeEngineFallback(locale: string): string {
  return locale === "en"
    ? "I couldn't complete that request. Please try again or rephrase."
    : "No he podido completar esa petición. Inténtalo de nuevo o reformula tu mensaje.";
}

/**
 * Safe fallback when the response contains unbacked work claims.
 */
export function safeUnbackedClaimFallback(locale: string): string {
  return locale === "en"
    ? "I'm working on it. I'll let you know when there's a result."
    : "Estoy en ello. Te aviso cuando haya un resultado.";
}

/**
 * Sanitize tool errors to prevent internal leakage.
 * Removes internal paths, stack traces, env vars, and sensitive details.
 */
export function sanitizeToolError(error: unknown): string {
  const message = String(error);
  // Remove internal paths
  let sanitized = message
    .replace(/\/home\/node\/[^\s)]+/g, "[internal]")
    .replace(/\/Volumes\/[^\s)]+/g, "[internal]")
    .replace(/\/Users\/[^\s)]+/g, "[internal]")
    .replace(/\/var\/[^\s)]+/g, "[internal]")
    .replace(/\/tmp\/[^\s)]+/g, "[internal]");
  // Remove stack traces (at ... (file:line:col) pattern)
  // Match "at something (file:line:col)" or "at file:line:col"
  sanitized = sanitized
    .replace(/\bat\s+[^\n]+\(\[[^\]]*\]\)/g, "[stack]")
    .replace(/\bat\s+[^\n]+\([^)]*\d+:\d+\)/g, "[stack]")
    .replace(/\bat\s+.+\.ts:\d+:\d+/g, "[stack]")
    .replace(/\bat\s+.+\.js:\d+:\d+/g, "[stack]")
    .replace(/\bat\s+.+\.mjs:\d+:\d+/g, "[stack]");
  // Remove env vars
  sanitized = sanitized
    .replace(/\b[A-Z_]+=[^\s]+/g, "[env]")
    .replace(/\bprocess\.env\.[A-Z_]+/g, "[env]");
  // Remove token patterns
  sanitized = sanitized
    .replace(/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{10,}\b/g, "[redacted]")
    .replace(/\b(?:bearer|token|pat)\s*[:=]\s*\S+/gi, "[redacted]");
  return sanitized;
}

/**
 * Centralized sanitization for all CEO-facing responses.
 *
 * Pipeline:
 * 1. Strip tool call XML tags
 * 2. Check for internal runtime leaks → replace with safe fallback
 * 3. Check for engine error text → replace with safe fallback
 * 4. Check for unbacked work claims → replace with safe message
 * 5. Check for unsupported promises → replace with safe message
 * 6. Return sanitized text
 *
 * @param text - Raw response from the engine
 * @param locale - User locale for fallback messages
 * @param options - Optional overrides
 * @returns Sanitized response safe for CEO consumption
 */
export function sanitizeCEOResponse(
  text: string,
  locale: string = "es",
  options: {
    /** Skip unbacked work claim detection (e.g., when real work is running). */
    skipUnbackedCheck?: boolean;
    /** Custom fallback text instead of the default. */
    customFallback?: string;
  } = {},
): string {
  // Step 1: Strip tool call tags
  let sanitized = stripToolCallTags(text);

  // Step 2: Check for internal runtime leaks
  if (isInternalRuntimeLeak(sanitized)) {
    return options.customFallback ?? safeEngineFallback(locale);
  }

  // Step 3: Check for engine error text
  if (isEngineErrorText(sanitized)) {
    return options.customFallback ?? safeEngineFallback(locale);
  }

  // Step 4: Check for unbacked work claims
  if (!options.skipUnbackedCheck && detectUnbackedWorkClaim(sanitized)) {
    return safeUnbackedClaimFallback(locale);
  }

  // Step 5: Check for unsupported promises
  if (detectUnsupportedPromise(sanitized)) {
    return safeUnbackedClaimFallback(locale);
  }

  return sanitized;
}

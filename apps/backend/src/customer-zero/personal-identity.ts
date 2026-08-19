/**
 * Personal identity — Sprint 67 P0.1-A.
 *
 * Departify must know how to call the entrepreneur without ever calling
 * them "CEO". There is no canonical name source anywhere else in the
 * product (auth exposes only id + email; onboarding captures company
 * fields, not person fields), so the Company DNA record is the durable
 * home for the preferred name.
 *
 * THREE RULES ENFORCED HERE
 *
 *   1. TRABAJO > PERFIL. Not knowing the name never blocks work. The
 *      extraction below is a best-effort read of the user's message; a
 *      miss simply means we keep not knowing.
 *   2. Ask at most ONCE, durably (`entrepreneurNameRequestedAt`). After
 *      one opportunity, Departify never asks again.
 *   3. Persist server-side only. The browser is never the source of
 *      truth; the name survives reload, restarts and new conversations.
 */

import type {
  CompanyDnaRecord,
  CompanyDnaStore,
} from "./company-dna.js";
import type { CustomerZeroSession } from "./customer-zero-session.js";

/** Maximum accepted length for a captured preferred name. */
const MAX_NAME_LENGTH = 40;

/**
 * Deterministic extraction of a name introduction from a user message.
 * Returns null when the message does not contain a recognizable
 * introduction — callers must treat null as "keep working normally".
 *
 * Recognized shapes (Spanish-first, English tolerated):
 *   "me llamo Marta" / "puedes llamarme Marta" / "mi nombre es Marta"
 *   "soy Marta" / "call me Marta" / "my name is Marta"
 *
 * A bare short answer ("Marta", "Marta López") is NOT trusted here on
 * its own; `extractEntrepreneurNameFromAnswer` handles that case only
 * when Departify actually asked the question in the previous turn.
 */
export function extractEntrepreneurNameIntroduction(
  message: string,
): string | null {
  const text = message.trim();
  if (!text) return null;
  const match =
    /(?:puedes\s+llamarme|me\s+llamo|llámame|puedes\s+decirme|mi\s+nombre\s+es|puedes\s+llamarme\s+a\s*|soy|call\s+me|my\s+name\s+is|i\s+am)\s+([^\n,.!?;:]{2,60})/i.exec(
      text,
    );
  if (!match) return null;
  return normalizePreferredName(match[1] ?? "");
}

/**
 * Captures a bare-name ANSWER. Only valid when the previous assistant
 * turn asked the canonical question — the caller proves that with the
 * last assistant message. Even then, a business request must never be
 * misread as a name ("Audita el SEO" is work, not a person).
 */
export function extractEntrepreneurNameFromAnswer(
  message: string,
  lastAssistantMessage: string | null,
): string | null {
  if (!lastAssistantMessage) return null;
  if (
    !/c[oó]mo\s+quieres\s+que\s+te\s+llame|c[oó]mo\s+te\s+llamo|c[oó]mo\s+te\s+llamas|tu\s+nombre|how\s+(?:should\s+i|do\s+i|would\s+you\s+like\s+me\s+to)\s+call\s+you|what(?:'s|\s+is)\s+your\s+name/i.test(
      lastAssistantMessage,
    )
  ) {
    return null;
  }
  const text = message.trim();
  // A name answer is short, has no digits, no URLs, no email, no
  // question, and is not an imperative business request.
  if (text.length === 0 || text.length > MAX_NAME_LENGTH) return null;
  if (/[\d@]/.test(text)) return null;
  if (/[?]/.test(text)) return null;
  if (text.split(/\s+/).length > 4) return null;
  if (isLikelyBusinessRequest(text)) return null;
  return normalizePreferredName(text);
}

/**
 * Imperative verbs that mean the user is asking for work. A message
 * starting with one of these is never treated as a name answer.
 */
const BUSINESS_REQUEST_PATTERN =
  /^(?:audita|analiza|revisa|crea|prepara|env[ií]a|conecta|planifica|genera|busca|muestra|dame|listame|l[ií]stame|corrige|escribe|publica|programa|agenda|organic[ea]|convierte|resume|expl[ií]ca|help|make|create|send|check|review|connect|analyze|write|publish|schedule|prepare|fix|build|show|list|give)\b/i;

function isLikelyBusinessRequest(text: string): boolean {
  return BUSINESS_REQUEST_PATTERN.test(text.trim());
}

/**
 * Normalizes a raw capture into a storable name. Returns null when the
 * capture is not name-like (too long, digits, URLs, leftovers of a
 * longer sentence).
 */
export function normalizePreferredName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ").replace(/[.,;:!¡?¿]+$/g, "").trim();
  if (name.length < 2 || name.length > MAX_NAME_LENGTH) return null;
  if (/[\d@/\\]/.test(name)) return null;
  if (/https?:\/\//i.test(name)) return null;
  // Reject sentence leftovers like "Marta y audita mi web"
  if (name.split(" ").length > 4) return null;
  return name;
}

/**
 * Resolves the entrepreneur's preferred name with the agreed priority.
 * The durable DNA record wins (it is the canonical store); the session
 * projection is the same fact after hydration. There is no other
 * canonical source in the product today (no preferredName / firstName /
 * displayName / fullName anywhere in auth, onboarding or profile).
 */
export function resolveEntrepreneurPreferredName(
  record: CompanyDnaRecord | null,
  session?: Pick<CustomerZeroSession, "state"> | null,
): string | null {
  const fromRecord = record?.entrepreneurPreferredName ?? null;
  if (fromRecord && fromRecord.trim().length > 0) return fromRecord.trim();
  const fromSession = session?.state.entrepreneurPreferredName ?? null;
  if (fromSession && fromSession.trim().length > 0) return fromSession.trim();
  return null;
}

/** True when Departify already used its one opportunity to ask. */
export function entrepreneurNameAlreadyRequested(
  record: CompanyDnaRecord | null,
): boolean {
  return Boolean(record?.entrepreneurNameRequestedAt);
}

/**
 * Persists the captured preferred name server-side. Read-modify-write
 * that deliberately preserves `factsUpdatedAt` and every milestone: a
 * person's name is not a business fact and must never invalidate the
 * CEO's confirmation of the company understanding.
 *
 * Returns the updated record, or null when there is no durable record
 * yet (nothing to attach the name to — we do not fabricate DNA).
 */
export async function persistEntrepreneurPreferredName(
  store: CompanyDnaStore,
  organizationId: string,
  name: string,
): Promise<CompanyDnaRecord | null> {
  const normalized = normalizePreferredName(name);
  if (!normalized) return null;
  const record = await store.get(organizationId);
  if (!record) return null;
  if (record.entrepreneurPreferredName === normalized) return record;
  const updated: CompanyDnaRecord = {
    ...record,
    entrepreneurPreferredName: normalized,
  };
  await store.upsert(updated);
  return updated;
}

/**
 * Records that Departify had its one opportunity to ask for the name.
 * Also preserved as-is otherwise (never touches business facts).
 */
export async function markEntrepreneurNameRequested(
  store: CompanyDnaStore,
  organizationId: string,
  now: string,
): Promise<CompanyDnaRecord | null> {
  const record = await store.get(organizationId);
  if (!record || record.entrepreneurNameRequestedAt) return record ?? null;
  const updated: CompanyDnaRecord = {
    ...record,
    entrepreneurNameRequestedAt: now,
  };
  await store.upsert(updated);
  return updated;
}

/** Hydrates the session projection from the durable record. */
export function hydrateSessionPreferredName(
  session: Pick<CustomerZeroSession, "organizationId" | "state">,
  record: CompanyDnaRecord | null,
): void {
  session.state.entrepreneurPreferredName =
    record?.entrepreneurPreferredName ?? null;
}

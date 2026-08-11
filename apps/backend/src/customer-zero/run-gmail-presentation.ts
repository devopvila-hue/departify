/**
 * Gmail presentation — Central Chat UX P0.
 *
 * The CEO's email questions must produce a clean, intent-aware business
 * summary. Different intents require different Gmail queries AND
 * different presentation shapes:
 *
 *   "último correo" / "last email" / "more recent"
 *     → 1 result. Single structured item. No query jargon.
 *
 *   "tengo correos importantes" / "unread" / "no leídos" / "important"
 *     → up to 5 unread. Prioritized. Each item as a structured entry.
 *
 *   "busca un correo de X" / "search email from X"
 *     → up to 5 results matching the sender/topic. Query stays internal.
 *
 *   generic inbox read
 *     → up to 5 recent inbox items. Sender / subject / received /
 *       short snippet only.
 *
 * Never expose raw Gmail query syntax (`in:inbox newer_than:7d`) to the
 * CEO. Never concatenate one giant paragraph. Never leak `&quot;`,
 * `&#39;`, `&amp;`, `&lt;`, `&gt;` from the Gmail API payload.
 *
 * Security: email subject and snippet are UNTRUSTED data. Decode only
 * the safe HTML entities that escaped into Gmail's plain-text
 * representation; do NOT render or execute any HTML.
 */

import type { SupportedLocale } from "./locale.js";

export type GmailReadIntent =
  | "latest"
  | "important"
  | "unread"
  | "search"
  | "recent";

export interface GmailSummaryItem {
  readonly id: string;
  readonly threadId: string;
  readonly sender: string;
  readonly senderEmail: string;
  readonly subject: string;
  readonly receivedAt: string;
  readonly snippet: string;
  readonly unread: boolean;
}

export interface GmailReadPlan {
  readonly intent: GmailReadIntent;
  readonly query: string;
  readonly maxResults: number;
}

const GMAIL_RESULT_CAP = 10;

function requestedResultCount(message: string): number | null {
  const lower = message.toLowerCase().normalize("NFC");
  const words: Record<string, number> = {
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };
  const quantity = lower.match(/\b(?:los|las)\s+(\d{1,2}|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:últim(?:o|os|a|as)|ultim(?:o|os|a|as)|recient(?:e|es))\b/u)
    ?? lower.match(/\b(?:mu[eé]strame|ens[eé]ñame|dame)\s+(?:los|las)?\s*(\d{1,2}|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:últim(?:o|os|a|as)|ultim(?:o|os|a|as)|recient(?:e|es)|mails?|correos?|emails?)\b/u);
  const explicit = quantity?.[1];
  const numeric = lower.match(/(?:últim(?:o|os|a|as)|ultim(?:o|os|a|as)|recent(?:e|s)?|recient(?:e|es)?)\s+(\d{1,2})\b/u)
    ?? lower.match(/\b(?:los|las)?\s*(\d{1,2})\s+(?:últim(?:o|os|a|as)|ultim(?:o|os|a|as)|mails?|correos?|emails?)\b/u);
  const word = lower.match(/(?:últim(?:o|os|a|as)|ultim(?:o|os|a|as)|recent(?:e|s)?|recient(?:e|es)?)\s+([a-záéíóú]+)\b/u)
    ?? lower.match(/(?:\b(?:los|las)\s+)?([a-záéíóú]+)\s+(?:últim(?:o|os|a|as)|ultim(?:o|os|a|as)|mails?|correos?|emails?)\b/u);
  const value = explicit
    ? (Number.isFinite(Number(explicit)) ? Number(explicit) : words[explicit])
    : numeric?.[1] ? Number(numeric[1]) : word?.[1] ? words[word[1]] : null;
  return value && Number.isFinite(value) ? Math.max(1, Math.min(GMAIL_RESULT_CAP, value)) : null;
}

/** Map the CEO's email question to an intent + Gmail query + result cap. */
export function deriveGmailReadPlan(message: string): GmailReadPlan {
  // Normalize to NFC so accents like "último" composed by the runtime
  // (UTF-8) match the regex literals in this source file (also UTF-8).
  const lower = message.toLowerCase().normalize("NFC");

  const count = requestedResultCount(lower);

  // Latest / last / most recent — one mail unless the CEO asks for a bounded
  // quantity explicitly.
  // Note: `\b` is unreliable on Unicode inputs in some JS runtimes,
  // so we anchor on `(?:^|\W)` / `(?:\W|$)` for portable boundaries.
  if (
    /(?:^|\W)([úu]ltim(?:o|os|a|as)|last|latest|more recent|most recent)(?:\W|$)/u.test(
      lower,
    )
  ) {
    return {
      intent: "latest",
      query: "in:inbox newer_than:30d",
      maxResults: count ?? 1,
    };
  }

  if (/(?:^|\W)recient(?:e|es)(?:\W|$)/u.test(lower)) {
    return {
      intent: "recent",
      query: "in:inbox newer_than:7d",
      maxResults: count ?? 5,
    };
  }

  // Unread / no leídos.
  if (/(?:^|\W)(unread|no\s+le[íi]dos?|sin\s+leer|pendientes)(?:\W|$)/u.test(lower)) {
    return {
      intent: "unread",
      query: "is:unread newer_than:30d",
      maxResults: count ?? 5,
    };
  }

  // Important / urgent — usually the same as unread, just a different label.
  if (
    /(?:^|\W)(importante?s?|urgentes?|priority)(?:\W|$)/.test(lower)
  ) {
    return {
      intent: "important",
      query: "is:unread newer_than:30d",
      maxResults: count ?? 5,
    };
  }

  // Search by sender or topic.
  if (/(?:^|\W)(busca|buscar|search|find|encuentra|localiza)(?:\W|$)/.test(lower)) {
    const sender = lower.match(/\b(?:de|from)\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i)?.[1];
    const senderName = lower.match(/\b(?:de|from)\s+([\p{L}][\p{L} .'-]{1,60}?)(?:\s+(?:y|and|sobre|about)|[?.!,]|$)/iu)?.[1]?.trim();
    const topic = lower.match(/\b(?:sobre|about|con el asunto|subject)\s+([^?.!]+)$/i)?.[1]?.trim();
    return {
      intent: "search",
      query: sender
        ? `from:${sender} newer_than:365d`
        : senderName
          ? `from:${senderName} newer_than:365d`
        : topic
          ? `in:anywhere newer_than:365d {subject:${topic} ${topic}}`
          : "in:inbox newer_than:30d",
      maxResults: count ?? 5,
    };
  }

  // Default: recent inbox reading.
  return {
    intent: "recent",
    query: "in:inbox newer_than:7d",
    maxResults: count ?? 5,
  };
}

/**
 * Safe decode of HTML entities that Gmail's plain-text fields commonly
 * contain. We do NOT execute, sanitize for HTML, or interpret any tags.
 * This is a strict character-level decode of a known safe subset.
 */
export function decodeHtmlEntities(value: string): string {
  if (!value) return "";
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Build a single-line sender label, decoded safely. */
function formatSender(raw: {
  readonly email: string;
  readonly displayName?: string;
}): { sender: string; senderEmail: string } {
  const email = decodeHtmlEntities(raw.email);
  const displayName = raw.displayName
    ? decodeHtmlEntities(raw.displayName)
    : "";
  return {
    senderEmail: email,
    sender: displayName ? `${displayName} <${email}>` : email,
  };
}

/** Light, deterministic importance estimate from sender + subject only. */
function estimateImportance(senderEmail: string, subject: string): number {
  const lower = (senderEmail + " " + subject).toLowerCase();
  const signals: Array<[RegExp, number]> = [
    [/factura|invoice|receipt|payment|cobro|pago|transferencia/i, 0.85],
    [/urgent|asap|inmediato|importante|priority/i, 0.75],
    [/contrato|contract|legal|firma/i, 0.75],
    [/reunión|meeting|call|appointment|entrevista|cita/i, 0.6],
    [/soporte|support|ticket|help/i, 0.55],
    [/newsletter|promo|oferta|offer|subscription|unsubscribe/i, 0.15],
    [/no-?reply|noreply|notifications?@|marketing@|news@/i, 0.2],
    [/linkedin|twitter|facebook|instagram|tiktok/i, 0.25],
  ];
  for (const [pattern, score] of signals) {
    if (pattern.test(lower)) return score;
  }
  return 0.4;
}

interface RawGmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly from: { readonly email: string; readonly displayName?: string };
  readonly subject: string;
  readonly snippet: string;
  readonly date: string;
  readonly isUnread: boolean;
}

/** Normalize + decode a Gmail message for safe presentation. */
export function summarizeGmailMessage(raw: RawGmailMessage): GmailSummaryItem {
  const subject = decodeHtmlEntities(raw.subject || "(sin asunto)");
  const snippet = decodeHtmlEntities(raw.snippet || "").slice(0, 240);
  const receivedAt = raw.date || "";
  const { sender, senderEmail } = formatSender(raw.from);
  return {
    id: raw.id,
    threadId: raw.threadId,
    sender,
    senderEmail,
    subject,
    receivedAt,
    snippet,
    unread: raw.isUnread,
  };
}

/**
 * Best-effort human-friendly received time. Gmail returns an RFC-2822
 * date; we don't import a date library. Trim to the weekday + day + time.
 */
export function humanReceivedAt(raw: string): string {
  const decoded = decodeHtmlEntities(raw);
  if (!decoded) return "";
  // RFC-2822: "Tue, 12 Aug 2026 09:14:22 +0000"
  // Pull the leading day-of-week + day + month + year + time, skip the TZ.
  const match = decoded.match(
    /^([A-Za-zÁáÉéÍíÓóÚúÑñ]{2,3}),?\s+(\d{1,2})\s+([A-Za-zÁáÉéÍíÓóÚúÑñ]{3,9})\s+(\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)/,
  );
  if (!match) return decoded.slice(0, 60);
  const [, , day, , year, time] = match;
  return `${day} ${match[3]} ${year}, ${time}`;
}

/**
 * Render the Gmail summary for a given intent. The CEO never sees raw
 * query syntax, HTML entities, or a one-paragraph dump. Multi-item
 * lists are visibly separated.
 */
export function renderGmailSummary(input: {
  readonly intent: GmailReadIntent;
  readonly items: readonly GmailSummaryItem[];
  readonly locale: SupportedLocale;
  readonly totalFound: number;
  /** CEO-requested cap, when known, used to describe a short API result honestly. */
  readonly requestedMaxResults?: number;
}): string {
  if (input.items.length === 0) {
    return renderEmpty(input.intent, input.locale);
  }
  switch (input.intent) {
    case "latest":
      return input.requestedMaxResults && input.requestedMaxResults > 1
        ? renderList(input.items, "latest", input.locale, input.totalFound, input.requestedMaxResults)
        : renderLatest(input.items[0]!, input.locale);
    case "unread":
    case "important":
      return renderImportant(input.items, input.locale, input.totalFound);
    case "search":
    case "recent":
      return renderList(input.items, input.intent, input.locale, input.totalFound, input.requestedMaxResults);
  }
}

function renderEmpty(intent: GmailReadIntent, locale: SupportedLocale): string {
  const isEs = locale !== "en";
  switch (intent) {
    case "latest":
      return isEs
        ? "No he encontrado un correo reciente en tu bandeja. Si esperabas algo concreto, dime el remitente o el tema y lo busco."
        : "I didn't find a recent email in your inbox. If you were expecting something specific, share the sender or topic and I'll search.";
    case "unread":
      return isEs
        ? "No tienes correos sin leer. Tu bandeja está al día."
        : "You have no unread emails. Your inbox is up to date.";
    case "important":
      return isEs
        ? "No he visto correos que parezcan necesitar tu atención ahora mismo."
        : "I don't see any emails that look like they need your attention right now.";
    default:
      return isEs
        ? "No he encontrado correos relevantes en tu bandeja. Si me das un remitente o un tema te ayudo a afinar la búsqueda."
        : "I didn't find any relevant emails in your inbox. Give me a sender or topic and I'll narrow the search.";
  }
}

function renderLatest(item: GmailSummaryItem, locale: SupportedLocale): string {
  const isEs = locale !== "en";
  const received = humanReceivedAt(item.receivedAt);
  const subject = item.subject || (isEs ? "(sin asunto)" : "(no subject)");
  const header = isEs
    ? "El último correo que has recibido"
    : "The most recent email you've received";
  const lines: string[] = [
    `${header}:`,
    "",
    `**De:** ${item.sender}`,
    `**Asunto:** ${subject}`,
  ];
  if (received) lines.push(`**Recibido:** ${received}`);
  if (item.snippet) lines.push("", item.snippet);
  return lines.join("\n");
}

function renderImportant(
  items: readonly GmailSummaryItem[],
  locale: SupportedLocale,
  totalFound: number,
): string {
  const isEs = locale !== "en";
  // Sort by estimated importance descending.
  const ranked = [...items].sort(
    (a, b) =>
      estimateImportance(b.senderEmail, b.subject) -
      estimateImportance(a.senderEmail, a.subject),
  );
  const head = isEs
    ? totalFound > items.length
      ? `He encontrado ${totalFound} correos que podrían necesitar tu atención. Los ${items.length} más relevantes:`
      : `He encontrado ${items.length} correo${items.length === 1 ? "" : "s"} que podrían necesitar tu atención:`
    : totalFound > items.length
      ? `I found ${totalFound} emails that may need your attention. The ${items.length} most relevant:`
      : `I found ${items.length} email${items.length === 1 ? "" : "s"} that may need your attention:`;
  const body = ranked
    .map((item, index) => {
      const score = estimateImportance(item.senderEmail, item.subject);
      const why = isEs
        ? importanceReasonEs(score)
        : importanceReasonEn(score);
      const received = humanReceivedAt(item.receivedAt);
      const lines: string[] = [
        `${index + 1}. **${item.sender}** — ${item.subject || (isEs ? "(sin asunto)" : "(no subject)")}`,
      ];
      if (received) lines.push(`   ${received}${item.unread ? (isEs ? " · sin leer" : " · unread") : ""}`);
      if (item.snippet) lines.push(`   ${item.snippet}`);
      if (why) lines.push(`   _${why}_`);
      return lines.join("\n");
    })
    .join("\n\n");
  return `${head}\n\n${body}`;
}

function renderList(
  items: readonly GmailSummaryItem[],
  intent: GmailReadIntent,
  locale: SupportedLocale,
  totalFound: number,
  requestedMaxResults?: number,
): string {
  const isEs = locale !== "en";
  const head = isEs
    ? intent === "search"
      ? totalFound > items.length
        ? `He encontrado ${totalFound} correos que coinciden con tu búsqueda. Los ${items.length} más relevantes:`
        : `He encontrado ${items.length} correo${items.length === 1 ? "" : "s"} que coinciden con tu búsqueda:`
      : requestedMaxResults && items.length < requestedMaxResults
        ? `He encontrado ${items.length} correo${items.length === 1 ? "" : "s"} de los ${requestedMaxResults} solicitados; Gmail solo ha devuelto ese resultado.`
      : totalFound > items.length
        ? `Estos son los ${items.length} más recientes de los ${totalFound} que he visto en tu bandeja:`
        : intent === "latest"
          ? `Estos son los ${items.length} últimos correos recibidos:`
          : `Esto es lo más reciente en tu bandeja:`
    : intent === "search"
      ? totalFound > items.length
        ? `I found ${totalFound} emails matching your search. The ${items.length} most relevant:`
        : `I found ${items.length} email${items.length === 1 ? "" : "s"} matching your search:`
      : requestedMaxResults && items.length < requestedMaxResults
        ? `I found ${items.length} email${items.length === 1 ? "" : "s"} of the ${requestedMaxResults} requested; Gmail returned only that result.`
      : totalFound > items.length
        ? `These are the ${items.length} most recent of the ${totalFound} I saw in your inbox:`
        : intent === "latest"
          ? `These are the ${items.length} most recent emails received:`
          : `This is the most recent in your inbox:`;
  const body = items
    .map((item, index) => {
      const received = humanReceivedAt(item.receivedAt);
      const subject = item.subject || (isEs ? "(sin asunto)" : "(no subject)");
      const parts: string[] = [`${index + 1}. **${item.sender}** — ${subject}`];
      if (received) parts.push(`   ${received}${item.unread ? (isEs ? " · sin leer" : " · unread") : ""}`);
      if (item.snippet) parts.push(`   ${item.snippet}`);
      return parts.join("\n");
    })
    .join("\n\n");
  return `${head}\n\n${body}`;
}

function importanceReasonEs(score: number): string {
  if (score >= 0.75) {
    return `Puede requerir atención: ${labelForScoreEs(score)}.`;
  }
  if (score <= 0.25) {
    return "Parece informativo o promocional; no requiere acción inmediata.";
  }
  return "Importancia estimada a partir del remitente y el asunto.";
}

function importanceReasonEn(score: number): string {
  if (score >= 0.75) {
    return `May need attention: ${labelForScoreEn(score)}.`;
  }
  if (score <= 0.25) {
    return "Looks informational or promotional; no immediate action needed.";
  }
  return "Importance estimated from sender and subject.";
}

function labelForScoreEs(score: number): string {
  if (score >= 0.85) return "pagos o facturación";
  if (score >= 0.75) return "asuntos contractuales o urgentes";
  if (score >= 0.6) return "reuniones o citas";
  return "soporte o consultas";
}

function labelForScoreEn(score: number): string {
  if (score >= 0.85) return "billing or payment";
  if (score >= 0.75) return "contract or urgent";
  if (score >= 0.6) return "meetings or appointments";
  return "support or inquiries";
}

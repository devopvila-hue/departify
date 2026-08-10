/**
 * Pending email work — Customer Zero Email P0.
 *
 * The CEO's email requests are multi-turn: Departify may need the
 * recipient, the message, or the approval before it can send. This
 * module owns the durable-in-session state that lets a follow-up like
 * "Son A, B y C" continue the SAME pending email instead of falling
 * into a generic route, forgetting the recipient, or producing the
 * generic red error.
 *
 * Security: the pending state NEVER contains credentials. It holds
 * only the business fields (recipient, objective, draft text) plus a
 * status. The draft body is CEO-authored content, treated as DATA
 * everywhere (never instructions — see prompt-injection boundary).
 */

import type { SupportedLocale } from "./locale.js";

export type PendingEmailStatus =
  | "awaiting_info" // missing recipient and/or objective
  | "draft_ready" // draft built, waiting for approval (or direct send)
  | "awaiting_approval" // CEO must approve before send
  | "sending"
  | "sent"
  | "cancelled";

export interface PendingEmailDraft {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface PendingEmailWork {
  readonly id: string;
  status: PendingEmailStatus;
  /** Recipient address (or display name + address), once known. */
  recipient: string | null;
  /** What the CEO wants the email to say/achieve. */
  objective: string | null;
  /** Fields still missing, in business language. */
  missingFields: readonly string[];
  /** The built draft, once the fields are sufficient. */
  draft: PendingEmailDraft | null;
  /** Provider used for the send, once executed (e.g. "gmail"). */
  provider: string | null;
  /** Durable send evidence (never credentials). */
  sendResult: {
    readonly provider: string;
    readonly recipient: string;
    readonly sentAt: string;
    readonly providerMessageId: string | null;
  } | null;
  /** When the pending work was last touched. */
  updatedAt: string;
}

export function createPendingEmailWork(nowMs = Date.now()): PendingEmailWork {
  return {
    id: `pe_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    status: "awaiting_info",
    recipient: null,
    objective: null,
    missingFields: ["destinatario", "mensaje"],
    draft: null,
    provider: null,
    sendResult: null,
    updatedAt: new Date(nowMs).toISOString(),
  };
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

/**
 * Best-effort recipient extraction. Prefers an explicit address;
 * otherwise the text after "a"/"para" up to the objective marker.
 */
export function extractRecipient(message: string): string | null {
  const address = message.match(EMAIL_RE);
  if (address) return address[0];
  const afterTo = message.match(
    /\b(?:a|para|al|con)\s+([^.,;]+?)(?:\s+(?:diciendo|dici[ée]ndole|que|para\s+decir(?:le)?|con\s+el\s+(?:mensaje|texto)|sobre)\b|$)/i,
  );
  return afterTo ? afterTo[1]!.trim().replace(/^[¿¡!?\s]+|[.!?\s]+$/g, "") || null : null;
}

/**
 * Best-effort objective extraction: text after an explicit marker
 * ("diciendo", "que", "para decirle", "con el mensaje"). When the
 * message is a continuation ("Son A, B y C"), no marker is present and
 * the whole message IS the missing information.
 */
export function extractObjective(message: string): string | null {
  const marker = message.match(
    /\b(?:diciendo|dici[ée]ndole|que|para\s+decir(?:le)?|con\s+el\s+(?:mensaje|texto)|contenido)\b\s*:?\s*(.+)$/i,
  );
  if (marker?.[1]?.trim()) {
    // "diciendo que la reunión pasa al viernes" → drop the redundant
    // leading "que" kept after the marker.
    return marker[1].trim().replace(/^que\s+/i, "");
  }
  const afterPara = message.match(
    /\bpara\s+(?:enviar(?:le)?|escribir(?:le)?|mandar(?:le)?|comunicar(?:le)?|avisar(?:le)?|decir(?:le)?)\s+(.+)$/i,
  );
  if (afterPara?.[1]?.trim()) return afterPara[1].trim();
  return null;
}

/** True when the CEO message looks like a fresh email request. */
export function isEmailSendRequest(message: string): boolean {
  const lower = message.toLowerCase();
  const actionVerb =
    /\b(env[ií]a|enviar|manda|mandar|escribe|escribir|redacta|redactar|prepara|preparar|m[eé]ndale)\b/.test(
      lower,
    );
  if (!actionVerb) return false;
  return (
    /\b(correo|correos?|email|e-?mail|mensaje|mensajes|mail)\b/.test(lower) ||
    /\b(escribe|manda|env[ií]a|m[eé]ndale)\s+a\b/.test(lower) ||
    EMAIL_RE.test(lower)
  );
}

/** True when the CEO is answering an existing pending email (approval). */
export function isEmailApprovalResponse(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFC");
  return (
    /\b(s[ií],?\s*(env[ií]a(?:lo)?|m[aá]ndalo|adelante|hazlo|adelante con)|aprueba|aprobar|env[ií]a(?:lo)?\s*ya|go\s+ahead|send\s+it|approved?)\b/i.test(
      lower,
    )
  );
}

/** True when the CEO rejects/cancels the pending email. */
export function isEmailCancellation(message: string): boolean {
  const lower = message.toLowerCase().normalize("NFC");
  return (
    /\b(no\s+lo\s+env[ií]es|no\s+env[ií]es|no\s+lo\s+mandes|cancela|olv[ií]dalo|d[eé]jalo|déjalo\s+estar|quit[aá]|descarta|cancel)\b/i.test(
      lower,
    )
  );
}

/** Build a simple business draft from recipient + objective. */
export function buildEmailDraft(
  recipient: string,
  objective: string,
  locale: SupportedLocale,
): PendingEmailDraft {
  const isEs = locale !== "en";
  const clean = objective.replace(/\s+/g, " ").trim();
  const subject = isEs ? "Información" : "Information";
  // The body is a short, neutral restatement of the CEO's objective.
  const body = isEs
    ? `Hola,\n\n${clean}\n\nUn saludo.`
    : `Hello,\n\n${clean}\n\nBest regards.`;
  return { to: recipient, subject, body };
}

/** Business-language copy for the current missing fields. */
export function missingFieldsCopy(
  missing: readonly string[],
  locale: SupportedLocale,
): string {
  const isEs = locale !== "en";
  const labels: Record<string, string> = isEs
    ? { destinatario: "a quién quieres enviarlo", mensaje: "qué quieres decir" }
    : { recipient: "who you want to send it to", message: "what you want to say" };
  const mapped = missing.map((f) => labels[f] ?? f);
  if (isEs) {
    return `Para preparar el correo necesito saber ${mapped.join(" y ")}.`;
  }
  return `To prepare the email I need to know ${mapped.join(" and ")}.`;
}

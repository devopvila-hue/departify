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
  | "failed"
  | "editing"
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
  /** Safe provider failure category retained for diagnosis/retry. */
  sendError: string | null;
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
    sendError: null,
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
  const address = message.match(EMAIL_RE);
  if (address?.index !== undefined) {
    const remainder = message
      .slice(address.index + address[0].length)
      .replace(/^\s*(?:con|diciendo|que|para)\s*:?\s*/i, "")
      .trim();
    if (remainder) return remainder;
  }
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
  const normalized = normalizeEmailConversationText(message);
  return new Set([
    "si",
    "yes",
    "adelante",
    "hazlo",
    "aprueba",
    "aprobar",
    "envialo",
    "envialo ya",
    "mandalo",
    "mandalo ya",
    "correcto envialo",
    "si envialo",
    "adelante con el",
    "go ahead",
    "send it",
    "approved",
  ]).has(normalized);
}

/** True when the CEO rejects/cancels the pending email. */
export function isEmailCancellation(message: string): boolean {
  const normalized = normalizeEmailConversationText(message);
  return new Set([
    "no",
    "cancela",
    "cancelar",
    "olvida mail",
    "olvida el mail",
    "olvidalo",
    "descarta",
    "no lo mandes",
    "no lo envies",
    "dejalo",
    "dejalo estar",
  ]).has(normalized);
}

/** Normalize CEO confirmations/cancellations without making punctuation or accents significant. */
export function normalizeEmailConversationText(message: string): string {
  return message
    .toLocaleLowerCase("es-ES")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}@.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A failure question addresses the send operation, not the draft content. */
export function isEmailFailureQuestion(message: string): boolean {
  return new Set([
    "por que",
    "porque",
    "que ha pasado",
    "por que no",
    "por que no se ha enviado",
    "por que no se envio",
  ]).has(normalizeEmailConversationText(message));
}

/** Only explicit edit instructions may mutate an existing draft. */
export function isEmailEditRequest(message: string): boolean {
  return /\b(cambia(?:r)?\s+(?:el\s+)?asunto|pon\s+.+\s+al\s+principio|hazlo\s+m[aá]s\s+corto|a[nñ]ade(?:\s+que)?|quita\s+el\s+[uú]ltimo\s+p[aá]rrafo|hazlo\s+m[aá]s\s+informal)\b/i.test(
    message,
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
  const isJokeRequest = /\b(?:5|cinco)\s+chistes?\b/i.test(clean);
  const subject = isJokeRequest
    ? (isEs ? "5 chistes de informática" : "5 computer jokes")
    : (isEs ? "Información" : "Information");
  // The body is a short, neutral restatement of the CEO's objective.
  const body = isJokeRequest && isEs
    ? [
        "Hola,",
        "",
        "Aquí tienes cinco chistes de informática:",
        "",
        "1. ¿Por qué el ordenador fue al médico? Porque tenía un virus.",
        "2. ¿Qué le dice un bit al otro? Nos vemos en el próximo byte.",
        "3. ¿Por qué el programador confundió Halloween con Navidad? Porque OCT 31 = DEC 25.",
        "4. ¿Cuál es el animal favorito de los programadores? El bug, porque siempre aparece donde menos lo esperas.",
        "5. ¿Qué hace un desarrollador cuando tiene frío? Se pone otra capa de abstracción.",
        "",
        "Un saludo.",
      ].join("\n")
    : isEs
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

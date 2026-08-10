/**
 * Corporate email adapter — "Otro correo de empresa" (Customer Zero
 * Email P0). IMAP for read/search, SMTP for send.
 *
 * Every operation is BOUNDED (15s) so a hanging mail server can never
 * leave the connection stuck or block a chat turn. Probes never send
 * mail. Credentials never leave this boundary.
 */

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import type { CorporateEmailAccount } from "./corporate-email-store.js";

const OP_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms = OP_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("corporate_email_operation_timeout")),
        ms,
      ),
    ),
  ]);
}

export interface CorporateProbeResult {
  readonly imapOk: boolean;
  readonly smtpOk: boolean;
  readonly operational: boolean;
  readonly error: string | null;
}

/** Bounded IMAP connectivity + INBOX select probe (never sends mail). */
async function probeImap(account: CorporateEmailAccount): Promise<string | null> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, pass: account.password },
    logger: false,
  });
  try {
    await withTimeout(client.connect());
    try {
      const lock = await withTimeout(client.getMailboxLock("INBOX"));
      await lock.release();
    } finally {
      await withTimeout(client.logout());
    }
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "imap_probe_failed";
  }
}

/** Bounded SMTP session verification (connection + auth, no mail sent). */
async function probeSmtp(account: CorporateEmailAccount): Promise<string | null> {
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.username, pass: account.password },
    connectionTimeout: OP_TIMEOUT_MS,
    greetingTimeout: OP_TIMEOUT_MS,
    socketTimeout: OP_TIMEOUT_MS,
  });
  try {
    await withTimeout(transporter.verify());
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : "smtp_probe_failed";
  }
}

/** Probe both IMAP and SMTP. Operational ONLY when both succeed. */
export async function probeCorporateEmail(
  account: CorporateEmailAccount,
): Promise<CorporateProbeResult> {
  const [imapError, smtpError] = await Promise.all([
    probeImap(account),
    probeSmtp(account),
  ]);
  const imapOk = imapError === null;
  const smtpOk = smtpError === null;
  if (imapOk && smtpOk) {
    return { imapOk, smtpOk, operational: true, error: null };
  }
  const parts: string[] = [];
  if (!imapOk) parts.push(`IMAP: ${imapError}`);
  if (!smtpOk) parts.push(`SMTP: ${smtpError}`);
  return { imapOk, smtpOk, operational: false, error: parts.join("; ") };
}

export interface CorporateEmailMessage {
  readonly id: string;
  readonly threadId: string;
  readonly from: { email: string; displayName?: string };
  readonly subject: string;
  readonly snippet: string;
  readonly date: string;
  readonly isUnread: boolean;
}

/** Bounded inbox listing via IMAP. Returns recent messages, newest first. */
export async function readCorporateInbox(
  account: CorporateEmailAccount,
  maxResults = 5,
): Promise<readonly CorporateEmailMessage[]> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, pass: account.password },
    logger: false,
  });
  try {
    await withTimeout(client.connect());
    const lock = await withTimeout(client.getMailboxLock("INBOX"));
    try {
      const unseen = (await withTimeout(client.search({ seen: false }))) || [];
      const ids =
        unseen.length > 0
          ? unseen
          : (await withTimeout(client.search({ all: true }))) || [];
      // IMAP returns ascending UIDs; take the newest and reverse.
      const newest = ids.slice(-maxResults).reverse();
      const out: CorporateEmailMessage[] = [];
      for (const id of newest) {
        const fetched = await withTimeout(
          client.fetchOne(id, { envelope: true }),
        );
        if (!fetched) continue;
        const env = (fetched as { envelope?: unknown }).envelope as
          | {
              from?: Array<{ address?: string; name?: string }>;
              subject?: string;
              date?: Date;
            }
          | undefined;
        if (!env) continue;
        const from = env.from?.[0];
        const sender: { email: string; displayName?: string } = {
          email: from?.address ?? "desconocido",
        };
        if (from?.name) sender.displayName = from.name;
        out.push({
          id: String(id),
          threadId: String(id),
          from: sender,
          subject: env.subject ?? "",
          snippet: "",
          date: env.date?.toISOString() ?? "",
          isUnread: true,
        });
      }
      return out;
    } finally {
      await lock.release();
      await withTimeout(client.logout());
    }
  } catch {
    return [];
  }
}

/** Bounded SMTP send. Never fakes success. */
export async function sendCorporateEmail(
  account: CorporateEmailAccount,
  input: { to: string; subject: string; bodyText: string },
): Promise<{
  ok: boolean;
  providerMessageId: string | null;
  sentAt: string | null;
  error: string | null;
}> {
  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    auth: { user: account.username, pass: account.password },
    connectionTimeout: OP_TIMEOUT_MS,
    greetingTimeout: OP_TIMEOUT_MS,
    socketTimeout: OP_TIMEOUT_MS,
  });
  try {
    const sent = (await withTimeout(
      transporter.sendMail({
        from: account.displayName
          ? `"${account.displayName}" <${account.email}>`
          : account.email,
        to: input.to,
        subject: input.subject,
        text: input.bodyText,
      }),
    )) as { messageId?: string };
    return {
      ok: true,
      providerMessageId: sent.messageId ?? null,
      sentAt: new Date().toISOString(),
      error: null,
    };
  } catch (cause) {
    return {
      ok: false,
      providerMessageId: null,
      sentAt: null,
      error: cause instanceof Error ? cause.message : "smtp_send_failed",
    };
  }
}

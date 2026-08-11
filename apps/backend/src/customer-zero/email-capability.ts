/**
 * Email capability boundary — Customer Zero Email P0.
 *
 * Business logic asks for email.read / email.search / email.compose /
 * email.send — never provider-specific names. Providers (Google,
 * corporate IMAP/SMTP, ...) are infrastructure selected by this
 * boundary from the org's operational connections.
 *
 * Today Gmail is the only implemented provider; a corporate IMAP/SMTP
 * provider plugs in behind the same boundary.
 *
 * Security: this module never returns credentials. Send results carry
 * only provider message id + timestamp + recipient (durable evidence,
 * never secrets).
 */

import type { CustomerZeroSession } from "./customer-zero-session.js";
import {
  hasOperationalGoogleCapabilityForOrg,
} from "./credential-resolver.js";
import { getGoogleTokenStore } from "./google-tokens.js";
import {
  getCorporateEmailStore,
  type CorporateEmailAccount,
} from "./corporate-email-store.js";

export interface EmailSendInput {
  readonly to: string;
  readonly subject: string;
  readonly bodyText: string;
}

export interface EmailSendOutcome {
  readonly ok: boolean;
  readonly provider: string | null;
  readonly providerMessageId: string | null;
  readonly sentAt: string | null;
  /** Business-language failure reason; never a raw stack/token. */
  readonly error: string | null;
}

/** True when at least one email provider is operationally connected. */
export async function isEmailCapabilityOperational(
  organizationId: string,
): Promise<boolean> {
  return (
    (await resolveOperationalEmailProvider(organizationId)) !== null
  );
}

/**
 * Resolve the org's operational email provider. Deterministic rule:
 * the explicitly configured corporate account wins (it is the
 * company's own email); Google is the fallback default identity.
 * Returns null when nothing is operational.
 */
export async function resolveOperationalEmailProvider(
  organizationId: string,
): Promise<"corporate" | "google" | null> {
  try {
    const corporate = await getCorporateEmailStore().listForOrg(organizationId);
    const operational = corporate.find(
      (c) => c.operationalVerifiedAt !== null,
    );
    if (operational) return "corporate";
  } catch {
    // Store not wired (dev/test) — fall through to Google.
  }
  if (await hasOperationalGoogleCapabilityForOrg(organizationId, "email.read")) {
    return "google";
  }
  return null;
}

/**
 * Send an email through the org's operational provider. Never fakes
 * success: a non-ok outcome is surfaced honestly with a recovery hint.
 */
export async function sendEmail(
  session: CustomerZeroSession,
  input: EmailSendInput,
): Promise<EmailSendOutcome> {
  const organizationId = session.organizationId;
  const provider = await resolveOperationalEmailProvider(organizationId);
  if (!provider) {
    return {
      ok: false,
      provider: null,
      providerMessageId: null,
      sentAt: null,
      error: "email_not_connected",
    };
  }

  if (provider === "corporate") {
    const account = await loadOperationalCorporateAccount(organizationId);
    if (!account) {
      return {
        ok: false,
        provider: "corporate",
        providerMessageId: null,
        sentAt: null,
        error: "email_not_connected",
      };
    }
    const { sendCorporateEmail } = await import(
      "./corporate-email-adapter.js"
    );
    const outcome = await sendCorporateEmail(account, {
      to: input.to,
      subject: input.subject,
      bodyText: input.bodyText,
    });
    return {
      ok: outcome.ok,
      provider: "corporate",
      providerMessageId: outcome.providerMessageId,
      sentAt: outcome.sentAt,
      error: outcome.error,
    };
  }

  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) {
    return {
      ok: false,
      provider: "google",
      providerMessageId: null,
      sentAt: null,
      error: "google_not_configured",
    };
  }
  if (!(await hasOperationalGoogleCapabilityForOrg(organizationId, "email.send"))) {
    return {
      ok: false,
      provider: "google",
      providerMessageId: null,
      sentAt: null,
      error: "google_send_not_authorized",
    };
  }

  // Pick the first operational Google row for the org (the same
  // selection the Gmail read path uses).
  const summaries = await getGoogleTokenStore().listForOrg(organizationId);
  const target = summaries.find(
    (s) => s.hasRefreshToken && s.operationalVerifiedAt,
  );
  if (!target) {
    return {
      ok: false,
      provider: "google",
      providerMessageId: null,
      sentAt: null,
      error: "email_not_connected",
    };
  }

  const { GmailAdapter } = await import("./gmail-adapter.js");
  const adapter = new GmailAdapter(
    { organizationId, userId: target.userId },
    clientId,
    clientSecret,
  );
  const result = await adapter.sendMessage({
    to: [input.to],
    subject: input.subject,
    bodyText: input.bodyText,
  });
  if (result.success && result.value) {
    return {
      ok: true,
      provider: "google",
      providerMessageId: result.value.messageId ?? null,
      sentAt: result.value.sentAt ?? new Date().toISOString(),
      error: null,
    };
  }
  return {
    ok: false,
    provider: "google",
    providerMessageId: null,
    sentAt: null,
    error: result.errorCode ?? "send_failed",
  };
}

/** Load the org's operational corporate account (password stays internal). */
async function loadOperationalCorporateAccount(
  organizationId: string,
): Promise<CorporateEmailAccount | null> {
  const summaries = await getCorporateEmailStore().listForOrg(organizationId);
  const target = summaries.find((s) => s.operationalVerifiedAt !== null);
  if (!target) return null;
  return getCorporateEmailStore().get(organizationId, target.userId);
}

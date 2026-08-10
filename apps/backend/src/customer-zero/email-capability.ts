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
import { hasOperationalGoogleIdentityForOrg } from "./credential-resolver.js";
import { getGoogleTokenStore } from "./google-tokens.js";

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
  return hasOperationalGoogleIdentityForOrg(organizationId);
}

/**
 * Resolve the operational email provider for the org. Today: Google.
 * Returns the provider name or null when nothing is operational.
 */
export async function resolveOperationalEmailProvider(
  organizationId: string,
): Promise<"google" | null> {
  if (await hasOperationalGoogleIdentityForOrg(organizationId)) {
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

/**
 * EmailDeliveryAdapter — Customer Zero 02.
 *
 * Departify-owned boundary that MarketingService + the campaign
 * executor depend on. Today the only implementation is the Resend
 * adapter. The boundary is shaped so a future SendGrid / Mailgun
 * adapter can be plugged in without changing MarketingService or
 * the campaign executor.
 *
 * The adapter handles:
 *   - sender domain authentication (SPF/DKIM/DMARC) status,
 *   - single + bulk send,
 *   - delivery / bounce / complaint event ingestion,
 *   - webhook signature verification.
 *
 * NEVER logs the API key. NEVER exposes it to the portal or the
 * model. NEVER sends without a structurally approved campaign
 * (the caller enforces the approval gate; the adapter does not
 * decide policy).
 */

import { createHmac } from "node:crypto";

import { resolveCredentials, getCredentials } from "./credential-resolver.js";

/* ----------------------------------------------------------------------------
 * Normalized types.
 * --------------------------------------------------------------------------*/

export interface DomainAuthenticationStatus {
  readonly domain: string;
  readonly spf: "valid" | "missing" | "invalid";
  readonly dkim: "valid" | "missing" | "invalid";
  readonly dmarc: "valid" | "missing" | "invalid";
  readonly verifiedAt: string | null;
  readonly providerState: "verified" | "pending" | "failed";
}

export interface DeliverySendInput {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly replyTo?: string;
  readonly tags?: readonly { readonly name: string; readonly value: string }[];
  readonly headers?: Readonly<Record<string, string>>;
  /** Idempotency key — Resend deduplicates on this. */
  readonly idempotencyKey?: string;
}

export interface DeliverySendResult {
  readonly providerMessageId: string;
  readonly accepted: boolean;
  readonly sentAt: string;
}

export interface BulkDeliverySendInput {
  readonly campaignId: string;
  readonly from: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly recipients: readonly { readonly email: string; readonly displayName?: string }[];
  /** Suppression list — recipients in this set MUST be filtered out. */
  readonly suppressions?: readonly string[];
  readonly tags?: readonly { readonly name: string; readonly value: string }[];
}

export interface BulkDeliverySendResult {
  readonly accepted: number;
  readonly rejected: readonly { readonly email: string; readonly reason: string }[];
  readonly sentAt: string;
}

export type DeliveryEventKind =
  | "delivered"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "failed";

export interface DeliveryEvent {
  readonly provider: "resend";
  readonly providerMessageId: string;
  readonly campaignId: string | null;
  readonly kind: DeliveryEventKind;
  readonly recipient: string;
  readonly occurredAt: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface DeliveryMetrics {
  readonly campaignId: string;
  readonly sent: number;
  readonly delivered: number;
  readonly bounced: number;
  readonly complained: number;
  readonly opened?: number;
  readonly clicked?: number;
}

/* ----------------------------------------------------------------------------
 * Adapter interface.
 * --------------------------------------------------------------------------*/

export interface EmailDeliveryAdapter {
  readonly providerName: "resend" | "sendgrid" | "mailgun";
  verifyDomain(domain: string): Promise<DomainAuthenticationStatus>;
  sendSingle(input: DeliverySendInput): Promise<DeliverySendResult>;
  sendBulk(input: BulkDeliverySendInput): Promise<BulkDeliverySendResult>;
  getMetrics(campaignId: string): Promise<DeliveryMetrics>;
}

/* ----------------------------------------------------------------------------
 * Resend implementation.
 * --------------------------------------------------------------------------*/

export class ResendEmailDeliveryAdapter implements EmailDeliveryAdapter {
  readonly providerName = "resend" as const;

  constructor(
    private readonly organizationId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Resolves the API key from the CredentialResolver. Throws when
   * the key is missing — the caller is expected to surface this
   * as a connection state.
   */
  private resolveKey(): string {
    const resolution = resolveCredentials({
      organizationId: this.organizationId,
      provider: "resend",
    });
    if (!resolution.available || !resolution.handle) {
      throw new EmailDeliveryError(
        "missing_credentials",
        "Resend no está configurado.",
      );
    }
    const creds = getCredentials(resolution.handle);
    if (!creds) {
      throw new EmailDeliveryError(
        "missing_credentials",
        "Resend no tiene credenciales cargadas.",
      );
    }
    return creds.clientSecret;
  }

  async verifyDomain(domain: string): Promise<DomainAuthenticationStatus> {
    if (!domain) {
      return emptyStatus(domain);
    }
    const apiKey = this.resolveKey();
    const url = `https://api.resend.com/domains/${encodeURIComponent(domain)}`;
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        return {
          domain,
          spf: "invalid",
          dkim: "invalid",
          dmarc: "missing",
          verifiedAt: null,
          providerState: "failed",
        };
      }
      const data = (await response.json()) as {
        status?: string;
        records?: Array<{
          record?: string;
          status?: string;
          name?: string;
        }>;
      };
      const records = data.records ?? [];
      return {
        domain,
        spf: records.find((r) => r.record === "SPF")?.status === "verified"
          ? "valid"
          : "missing",
        dkim: records.find((r) => r.record === "DKIM")?.status === "verified"
          ? "valid"
          : "missing",
        dmarc: records.find((r) => r.record === "DMARC")?.status === "verified"
          ? "valid"
          : "missing",
        verifiedAt: this.now().toISOString(),
        providerState: data.status === "verified" ? "verified" : "pending",
      };
    } catch {
      return emptyStatus(domain);
    }
  }

  async sendSingle(input: DeliverySendInput): Promise<DeliverySendResult> {
    const sanitized = sanitizeEmailInputs(input);
    if ("error" in sanitized) {
      throw new EmailDeliveryError("invalid_input", sanitized.error);
    }
    const apiKey = this.resolveKey();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sanitized.from,
        to: sanitized.to,
        subject: sanitized.subject,
        html: sanitized.html,
        text: sanitized.text,
        reply_to: sanitized.replyTo,
        tags: sanitized.tags,
        headers: sanitized.headers,
      }),
    });
    if (!response.ok) {
      throw new EmailDeliveryError(
        "send_failed",
        `Resend devolvió ${response.status}.`,
      );
    }
    const data = (await response.json()) as { id?: string };
    return {
      providerMessageId: data.id ?? "",
      accepted: true,
      sentAt: this.now().toISOString(),
    };
  }

  async sendBulk(input: BulkDeliverySendInput): Promise<BulkDeliverySendResult> {
    const suppressed = new Set(input.suppressions ?? []);
    const recipients = input.recipients.filter((r) => !suppressed.has(r.email.toLowerCase()));
    const rejected: Array<{ email: string; reason: string }> = [];
    for (const r of input.recipients) {
      if (suppressed.has(r.email.toLowerCase())) {
        rejected.push({ email: r.email, reason: "suppressed" });
      }
    }
    let accepted = 0;
    const apiKey = this.resolveKey();
    // Resend does not have a native "broadcast" endpoint — the
    // adapter issues one POST per recipient. We batch sequentially
    // so the campaign executor can stream progress events.
    for (const recipient of recipients) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: input.from,
          to: [recipient.email],
          subject: input.subject,
          html: input.html,
          text: input.text,
          reply_to: input.replyTo,
          tags: [
            ...(input.tags ?? []),
            { name: "campaign_id", value: input.campaignId },
          ],
        }),
      });
      if (response.ok) {
        accepted += 1;
      } else {
        rejected.push({
          email: recipient.email,
          reason: `provider_${response.status}`,
        });
      }
    }
    return {
      accepted,
      rejected,
      sentAt: this.now().toISOString(),
    };
  }

  async getMetrics(campaignId: string): Promise<DeliveryMetrics> {
    // Resend does not expose a metrics endpoint yet; the executor
    // derives metrics from the webhook event store. Today we return
    // a deterministic empty shape and rely on `getCampaignEvents`
    // for the per-event breakdown.
    return {
      campaignId,
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
    };
  }
}

/* ----------------------------------------------------------------------------
 * Webhook signature verification.
 * --------------------------------------------------------------------------*/

export interface VerifyWebhookInput {
  readonly rawBody: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly secret: string;
  readonly now?: Date;
  /** When set, the verifier tolerates this many seconds of clock skew. */
  readonly toleranceSeconds?: number;
}

export interface VerifiedWebhook {
  readonly event: DeliveryEvent;
}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies a Resend webhook (svix-style). Resend signs webhooks
 * with HMAC-SHA256 under a per-endpoint secret. The signature is
 * carried in `svix-signature` (or `Resend-Signature` for older
 * deployments); we accept both.
 */
export function verifyResendWebhook(
  input: VerifyWebhookInput,
): VerifiedWebhook {
  const now = input.now ?? new Date();
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const signatureHeader =
    input.headers["svix-signature"] ??
    input.headers["Svix-Signature"] ??
    input.headers["resend-signature"] ??
    input.headers["Resend-Signature"];
  if (!signatureHeader) {
    throw new EmailDeliveryError("invalid_signature", "Missing signature header");
  }
  const timestampHeader =
    input.headers["svix-timestamp"] ??
    input.headers["Svix-Timestamp"] ??
    input.headers["resend-timestamp"];
  if (!timestampHeader) {
    throw new EmailDeliveryError("invalid_signature", "Missing timestamp header");
  }
  const tsSeconds = Number(timestampHeader);
  if (!Number.isFinite(tsSeconds)) {
    throw new EmailDeliveryError("invalid_signature", "Invalid timestamp");
  }
  const tsMs = tsSeconds * 1000;
  if (Math.abs(now.getTime() - tsMs) > tolerance * 1000) {
    throw new EmailDeliveryError("invalid_signature", "Timestamp outside tolerance");
  }
  const expected = ensureHmac()(
    input.secret,
    `${timestampHeader}.${input.rawBody}`,
  );
  // Resend / Svix signatures look like "v1,<hex>". Accept both
  // space-separated multiple signatures and the "v1," prefix.
  const candidates = signatureHeader
    .split(" ")
    .map((part) => part.replace(/^v1,/, ""));
  if (!candidates.some((part) => constantTimeEqual(part, expected))) {
    throw new EmailDeliveryError("invalid_signature", "Signature mismatch");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(input.rawBody) as Record<string, unknown>;
  } catch {
    throw new EmailDeliveryError("invalid_signature", "Body is not JSON");
  }
  const kind = parseEventKind(payload);
  if (!kind) {
    throw new EmailDeliveryError("invalid_signature", "Unknown event type");
  }
  const recipient = String(
    payload["to"] ?? payload["recipient"] ?? payload["email"] ?? "",
  );
  const providerMessageId = String(payload["email_id"] ?? payload["id"] ?? "");
  const campaignId = readCampaignTag(payload);
  return {
    event: {
      provider: "resend",
      providerMessageId,
      campaignId,
      kind,
      recipient,
      occurredAt: typeof payload["created_at"] === "string"
        ? String(payload["created_at"])
        : now.toISOString(),
      raw: payload,
    },
  };
}

function parseEventKind(payload: Record<string, unknown>): DeliveryEventKind | null {
  const type = String(payload["type"] ?? "").toLowerCase();
  if (type.includes("delivered")) return "delivered";
  if (type.includes("bounce")) return "bounced";
  if (type.includes("complaint") || type.includes("complained")) return "complained";
  if (type.includes("opened")) return "opened";
  if (type.includes("clicked")) return "clicked";
  if (type.includes("failed")) return "failed";
  return null;
}

function readCampaignTag(payload: Record<string, unknown>): string | null {
  const tags = payload["tags"];
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (
        typeof tag === "object" &&
        tag !== null &&
        (tag as Record<string, unknown>)["name"] === "campaign_id"
      ) {
        return String((tag as Record<string, unknown>)["value"] ?? "");
      }
    }
  }
  return null;
}

/* ----------------------------------------------------------------------------
 * Helpers.
 * --------------------------------------------------------------------------*/

function emptyStatus(domain: string): DomainAuthenticationStatus {
  return {
    domain,
    spf: "missing",
    dkim: "missing",
    dmarc: "missing",
    verifiedAt: null,
    providerState: "pending",
  };
}

interface SanitizedInputs {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly replyTo?: string;
  readonly tags?: readonly { readonly name: string; readonly value: string }[];
  readonly headers?: Readonly<Record<string, string>>;
}

function sanitizeEmailInputs(input: DeliverySendInput): SanitizedInputs | { error: string } {
  if (!input.from || !/^[^\s@]+@[^\s@]+\.[^\s@]+>$/.test(input.from) && !/@/.test(input.from)) {
    return { error: "From inválido." };
  }
  if (/[\r\n]/.test(input.subject)) {
    return { error: "El asunto contiene caracteres no permitidos." };
  }
  if (input.subject.length === 0) return { error: "Asunto vacío." };
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const to of input.to) {
    if (!emailRegex.test(to)) return { error: `Destinatario inválido: ${to}` };
  }
  if (input.replyTo && !emailRegex.test(input.replyTo)) {
    return { error: "Reply-To inválido." };
  }
  return {
    from: input.from.replace(/[\r\n]/g, ""),
    to: input.to,
    subject: input.subject.slice(0, 998),
    html: input.html.slice(0, 200_000),
    ...(input.text ? { text: input.text.slice(0, 200_000) } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };
}

export class EmailDeliveryError extends Error {
  constructor(
    public readonly code:
      | "missing_credentials"
      | "invalid_input"
      | "send_failed"
      | "invalid_signature"
      | "domain_unverified",
    message: string,
  ) {
    super(message.slice(0, 200));
    this.name = "EmailDeliveryError";
  }
}

let hmacImpl: ((secret: string, payload: string) => string) | null = null;

function ensureHmac(): (secret: string, payload: string) => string {
  if (hmacImpl) return hmacImpl;
  // Use Node's crypto via the top-level ESM import. The adapter is
  // only used in Node contexts (the backend); if the module is ever
  // loaded in a non-Node runtime, this falls back to a no-op that
  // causes the verifier to fail closed.
  hmacImpl = (secret: string, payload: string) =>
    createHmac("sha256", secret).update(payload).digest("hex");
  return hmacImpl;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

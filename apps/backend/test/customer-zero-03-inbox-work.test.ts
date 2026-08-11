import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryInboxStore } from "../src/customer-zero/inbox-domain.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";
import { HostingerEmailAdapter, HostingerEmailError } from "../src/customer-zero/hostinger-email-adapter.js";

/**
 * CZ03 — Inbox → work bridge.
 *
 * A classified InboxItem becomes a durable DepartmentTask through the
 * existing work store; the item is linked (relatedWorkItemId + state
 * `in_work`). The bridge reuses the task/approval/result infrastructure —
 * no new inbox runtime.
 */

const AUTH = { authorization: "Bearer token-a" };

describe("CZ03 — Inbox → work bridge", () => {
  let server: FastifyInstance;
  let inboxStore: InMemoryInboxStore;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    inboxStore = new InMemoryInboxStore();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      inbox: inboxStore,
    });
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    vi.restoreAllMocks();
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });
  }

  async function startOrg(): Promise<string> {
    const response = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  async function seedLeadItem(org: string): Promise<string> {
    const item = await inboxStore.upsert({
      organizationId: org,
      source: "gmail",
      sourceMessageId: "msg_lead_1",
      channel: "email",
      category: "lead",
      subject: "Consulta pricing",
      sender: { email: "cliente@acme.com", displayName: "Cliente" },
      recipients: [{ email: "ceo@departify.app" }],
      plainText: "Me interesa vuestro servicio",
      preview: "Me interesa vuestro servicio",
      receivedAt: new Date().toISOString(),
      unread: true,
      importance: 0.85,
      departmentId: "marketing",
      isLead: true,
      relatedWorkItemId: null,
      relatedConversationId: null,
      provenance: { provider: "gmail", rawEventId: "msg_lead_1" },
      state: "classified",
    });
    return item.id;
  }

  it("converts a lead InboxItem into a durable DepartmentTask", async () => {
    const org = await startOrg();
    const itemId = await seedLeadItem(org);
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/${itemId}/work`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.task.organizationId).toBe(org);
    expect(body.task.title).toContain("Oportunidad de cliente");
    expect(body.task.status).toBe("queued");
    // The item is now linked and in_work.
    expect(body.item.state).toBe("in_work");
    expect(body.item.relatedWorkItemId).toBe(body.task.id);
  });

  it("rejects a work bridge for an item from another org", async () => {
    const org = await startOrg();
    const itemId = await seedLeadItem(org);
    // user-b tries to convert user-a's item.
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/${itemId}/work`,
      headers: { authorization: "Bearer token-b" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns 404 for a missing item", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/missing-item/work`,
    });
    expect(response.statusCode).toBe(404);
  });

  it("is idempotent and exposes the same task through the work feed", async () => {
    const org = await startOrg();
    const itemId = await seedLeadItem(org);
    const first = await authedInject({ method: "POST", url: `/api/customer-zero/${org}/inbox/${itemId}/work` });
    const second = await authedInject({ method: "POST", url: `/api/customer-zero/${org}/inbox/${itemId}/work` });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().task.id).toBe(first.json().task.id);
    const feed = await authedInject({ method: "GET", url: `/api/customer-zero/${org}/work-feed` });
    expect(feed.statusCode).toBe(200);
    expect(feed.json().tasks).toEqual([expect.objectContaining({ id: first.json().task.id, organizationId: org })]);
  });

  it("keeps reply approval provider-affine and returns a terminal receipt", async () => {
    const org = await startOrg();
    const item = await inboxStore.upsert({
      organizationId: org,
      source: "hostinger",
      sourceMessageId: "host-incoming-1",
      sourceThreadId: "host-thread-1",
      channel: "email",
      category: "unknown",
      subject: "Consulta",
      sender: { email: "cliente@empresa.com" },
      recipients: [{ email: "ventas@empresa.com" }],
      plainText: "Hola",
      preview: "Hola",
      receivedAt: new Date().toISOString(),
      unread: true,
      importance: 0.4,
      departmentId: "marketing",
      isLead: false,
      relatedWorkItemId: null,
      relatedConversationId: null,
      provenance: { provider: "hostinger", rawEventId: "host-incoming-1", providerMessageUid: "42" },
      state: "classified",
    });
    const verify = vi.spyOn(HostingerEmailAdapter.prototype, "verifyCapability").mockResolvedValue(true);
    const reply = vi.spyOn(HostingerEmailAdapter.prototype, "replyMessage").mockResolvedValue({
      providerMessageId: "host-reply-1",
      sentAt: new Date().toISOString(),
    });
    const draft = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/${item.id}/reply/draft`,
      payload: { body: "Prueba respuesta desde Departify" },
    });
    expect(draft.statusCode).toBe(200);
    const approved = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/email/approve`,
      payload: { draftId: draft.json().draftId },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ status: "succeeded", receipt: { providerResourceId: "host-reply-1" } });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ messageId: "host-incoming-1", messageUid: "42", sourceFolder: "INBOX", to: "cliente@empresa.com" }));
    expect(verify).toHaveBeenCalled();
  });

  it("keeps an accepted Hostinger send ambiguous without retrying, then verifies without resending", async () => {
    const org = await startOrg();
    const verifyCapability = vi.spyOn(HostingerEmailAdapter.prototype, "verifyCapability").mockResolvedValue(true);
    const send = vi.spyOn(HostingerEmailAdapter.prototype, "sendMessage").mockRejectedValue(
      new HostingerEmailError("PROVIDER_ACCEPTED_UNVERIFIED", "accepted"),
    );
    const verifySent = vi.spyOn(HostingerEmailAdapter.prototype, "verifySentMessage").mockResolvedValue(null);
    const draft = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/email/draft`,
      payload: { provider: "hostinger", to: "controlled@example.com", subject: "Prueba", body: "Hola" },
    });
    const draftId = draft.json().draftId as string;

    const accepted = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/email/approve`,
      payload: { draftId },
    });
    expect(accepted.json()).toMatchObject({ status: "ambiguous", receipt: { status: "ambiguous", errorCategory: "PROVIDER_ACCEPTED_UNVERIFIED" } });
    expect(accepted.json().reply).toContain("Hostinger ha aceptado el envío");
    expect(accepted.json().reply).not.toContain("reintent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(verifyCapability).toHaveBeenCalled();

    const stillAccepted = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/email/approve`,
      payload: { draftId },
    });
    expect(stillAccepted.json().status).toBe("ambiguous");
    expect(send).toHaveBeenCalledTimes(1);
    expect(verifySent).toHaveBeenCalled();

    verifySent.mockResolvedValue({
      provider: "hostinger",
      providerMessageId: "verified-later",
      from: { email: "hello@departify.app" },
      to: [{ email: "controlled@example.com" }],
      cc: [],
      subject: "Prueba",
      preview: "Hola",
      receivedAt: new Date().toISOString(),
      sentAt: new Date().toISOString(),
      unread: false,
      flagged: false,
    });
    const verified = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/inbox/email/approve`,
      payload: { draftId },
    });
    expect(verified.json()).toMatchObject({ status: "succeeded", receipt: { providerResourceId: "verified-later" } });
    expect(verified.json().reply).toBe("Correo enviado y verificado.");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

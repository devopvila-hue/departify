/** Session projection and recovery for Sprint 68.1 pending work. */
import type { CustomerZeroSession } from "./customer-zero-session.js";
import type { PendingEmailWork } from "./pending-email.js";
import type { PendingFacebookPagesWork } from "./facebook-pages-publishing.js";
import type { PendingWorkType, DurablePendingWorkStatus } from "./pending-work-store.js";

type PendingCalendarWork = NonNullable<CustomerZeroSession["state"]["pendingCalendarWork"]>;

function now(): string { return new Date().toISOString(); }

function statusForEmail(work: PendingEmailWork): DurablePendingWorkStatus {
  if (work.status === "sent") return "succeeded";
  if (work.status === "cancelled") return "cancelled";
  if (work.status === "sending") return "executing";
  if (work.status === "accepted_unverified") return "ambiguous";
  if (work.status === "failed") return "failed";
  return "active";
}

function statusForCalendar(work: PendingCalendarWork): DurablePendingWorkStatus {
  return work.status === "creating" ? "executing" : "active";
}

function statusForFacebook(work: PendingFacebookPagesWork): DurablePendingWorkStatus {
  if (work.status === "published") return "succeeded";
  if (work.status === "cancelled") return "cancelled";
  if (work.status === "publishing") return "executing";
  if (work.status === "blocked") return "failed";
  return "active";
}

function calendarOperationId(work: PendingCalendarWork): string {
  return work.id ?? `calendar_${work.createdAt}_${work.summary}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validEmail(value: unknown): value is PendingEmailWork {
  return isRecord(value) && typeof value.id === "string" && typeof value.status === "string";
}

function validCalendar(value: unknown): value is PendingCalendarWork {
  return isRecord(value) && typeof value.summary === "string" && typeof value.createdAt === "string" && typeof value.status === "string";
}

function validFacebook(value: unknown): value is PendingFacebookPagesWork {
  return isRecord(value) && typeof value.id === "string" && typeof value.approvalId === "string" && typeof value.content === "string" && typeof value.status === "string";
}

/** Rebuild the in-process projection before the Sprint 68 pre-LLM resolver. */
export async function hydratePendingWorkForConversation(
  session: CustomerZeroSession,
  conversationId: string,
): Promise<void> {
  const [email, calendar, facebook] = await Promise.all([
    session.pendingWork.getActive(session.organizationId, conversationId, "email"),
    session.pendingWork.getActive(session.organizationId, conversationId, "calendar"),
    session.pendingWork.getActive(session.organizationId, conversationId, "facebook_pages"),
  ]);
  // Conversation Reliability War Room — Always overwrite in-memory state
  // with durable store version. The durable store is the source of truth.
  // This prevents stale pending work from blocking new operations after
  // a failed turn that left pending work in memory.
  if (email && validEmail(email.payload)) {
    session.state.pendingEmailWork = email.payload;
  } else if (!email) {
    delete session.state.pendingEmailWork;
  }
  if (calendar && validCalendar(calendar.payload)) {
    session.state.pendingCalendarWork = { ...calendar.payload, id: calendar.operationId };
  } else if (!calendar) {
    delete session.state.pendingCalendarWork;
  }
  if (facebook && validFacebook(facebook.payload)) {
    session.state.pendingFacebookPagesWork = facebook.payload;
  } else if (!facebook) {
    delete session.state.pendingFacebookPagesWork;
  }
}

/** Persist the current safe projection. Call before a side effect as well as at turn completion. */
export async function persistPendingWorkForConversation(
  session: CustomerZeroSession,
  conversationId: string,
  userId?: string,
): Promise<void> {
  const timestamp = now();
  const email = session.state.pendingEmailWork;
  if (email) {
    await session.pendingWork.upsert({
      operationId: email.id,
      organizationId: session.organizationId,
      conversationId,
      userId: userId ?? session.state.currentUserId ?? null,
      type: "email",
      status: statusForEmail(email),
      payload: { ...email },
      lastError: email.sendError,
      createdAt: email.updatedAt,
      updatedAt: timestamp,
    });
  }
  const calendar = session.state.pendingCalendarWork;
  if (calendar) {
    const operationId = calendarOperationId(calendar);
    await session.pendingWork.upsert({
      operationId,
      organizationId: session.organizationId,
      conversationId,
      userId: userId ?? session.state.currentUserId ?? null,
      type: "calendar",
      status: statusForCalendar(calendar),
      payload: { ...calendar, id: operationId },
      lastError: null,
      createdAt: calendar.createdAt,
      updatedAt: timestamp,
    });
  }
  const facebook = session.state.pendingFacebookPagesWork;
  if (facebook) {
    await session.pendingWork.upsert({
      operationId: facebook.id,
      organizationId: session.organizationId,
      conversationId,
      userId: userId ?? session.state.currentUserId ?? null,
      type: "facebook_pages",
      status: statusForFacebook(facebook),
      payload: { ...facebook },
      lastError: facebook.error ?? null,
      createdAt: facebook.createdAt,
      updatedAt: timestamp,
    });
  }
}

export async function completePendingWorkForConversation(
  session: CustomerZeroSession,
  conversationId: string,
  type: PendingWorkType,
  status: Extract<DurablePendingWorkStatus, "succeeded" | "cancelled" | "failed" | "ambiguous">,
  lastError: string | null = null,
): Promise<void> {
  await session.pendingWork.completeActive(session.organizationId, conversationId, type, status, lastError);
}

export async function persistPendingWorkAtTurnCompletion(
  session: CustomerZeroSession,
  conversationId: string,
  userId: string | undefined,
  completedType?: PendingWorkType,
  completedStatus?: "succeeded" | "cancelled",
): Promise<void> {
  await persistPendingWorkForConversation(session, conversationId, userId);
  if (completedType && completedStatus) {
    const stillPending = completedType === "email"
      ? Boolean(session.state.pendingEmailWork)
      : completedType === "calendar"
        ? Boolean(session.state.pendingCalendarWork)
        : Boolean(session.state.pendingFacebookPagesWork);
    if (!stillPending) {
      await completePendingWorkForConversation(session, conversationId, completedType, completedStatus);
    }
  }
}

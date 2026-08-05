import type { AgentId } from "../contracts/agent-contracts.js";
import { assertRuntimeValid } from "../validation/runtime-error.js";

export type AgentMessageKind = "command" | "event" | "notification";

export interface AgentMessage<TPayload = unknown> {
  id: string;
  kind: AgentMessageKind;
  senderId: AgentId;
  recipientId: AgentId;
  topic: string;
  payload: TPayload;
  createdAt: Date;
  correlationId?: string;
}

export interface AgentMessageEnvelope<TPayload = unknown> {
  message: AgentMessage<TPayload>;
  delivery: {
    attempts: number;
    scheduledAt?: Date;
  };
}

export function validateAgentMessage<TPayload>(
  message: AgentMessage<TPayload>,
): AgentMessage<TPayload> {
  assertRuntimeValid(message.id.trim().length > 0, "Message id is required.");
  assertRuntimeValid(
    message.senderId.trim().length > 0,
    "Message senderId is required.",
  );
  assertRuntimeValid(
    message.recipientId.trim().length > 0,
    "Message recipientId is required.",
  );
  assertRuntimeValid(
    message.topic.trim().length > 0,
    "Message topic is required.",
  );
  return message;
}

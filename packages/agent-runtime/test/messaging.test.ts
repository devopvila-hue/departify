import {
  AgentRuntimeValidationError,
  validateAgentMessage,
  type AgentMessageEnvelope,
} from "../src/index.js";

describe("agent messaging contracts", () => {
  it("validates internal message envelopes without transport coupling", () => {
    const envelope: AgentMessageEnvelope<{ action: string }> = {
      message: validateAgentMessage({
        id: "msg_001",
        kind: "command",
        senderId: "agent_sender",
        recipientId: "agent_recipient",
        topic: "runtime.lifecycle",
        payload: { action: "start" },
        createdAt: new Date("2026-08-05T00:00:00.000Z"),
      }),
      delivery: {
        attempts: 0,
      },
    };

    expect(envelope.message.topic).toBe("runtime.lifecycle");
  });

  it("rejects invalid internal messages", () => {
    expect(() =>
      validateAgentMessage({
        id: "",
        kind: "event",
        senderId: "agent_sender",
        recipientId: "agent_recipient",
        topic: "runtime.lifecycle",
        payload: {},
        createdAt: new Date(),
      }),
    ).toThrow(AgentRuntimeValidationError);
  });
});

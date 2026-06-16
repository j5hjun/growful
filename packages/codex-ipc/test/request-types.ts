import { CodexIpcClient } from "../src/client.ts";
import type { ThreadFollowerStartTurnResponse } from "../src/index.ts";

const client = new CodexIpcClient();

const startTurnResult: Promise<ThreadFollowerStartTurnResponse> = client.request(
  "thread-follower-start-turn",
  {
    conversationId: "conversation-1",
    turnStartParams: {
      clientUserMessageId: "message-1",
      input: [{ type: "text", text: "hello" }],
      cwd: "/workspace/growful",
    },
  },
  { version: 1 },
);

void startTurnResult;

client.request("thread-follower-steer-turn", {
  conversationId: "conversation-1",
  clientUserMessageId: "message-1",
  input: [{ type: "text", text: "hello" }],
  expectedTurnId: "turn-1",
});

client.request("thread-follower-start-turn", {
  conversationId: "conversation-1",
  // @ts-expect-error start-turn requires turnStartParams, not a top-level input object.
  input: {
    type: "user_message",
    text: "wrong shape",
  },
});

import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { CodexIpcClient } from "../src/client.ts";
import { encodeMessage, FrameDecoder } from "../src/framing.ts";
import type {
  CodexIpcBroadcastMessage,
  CodexIpcDiscoveryResponseMessage,
  CodexIpcMessage,
  CodexIpcRequestMessage,
} from "../src/protocol.ts";
import type {
  ThreadStreamStateChangedEvent,
} from "../src/index.ts";

const sockets = new Set<net.Socket>();
const servers = new Set<net.Server>();

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.clear();
  sockets.clear();
});

async function createIpcTestServer(
  onMessage: (message: CodexIpcMessage, socket: net.Socket) => void,
): Promise<{ server: net.Server; socketPath: string }> {
  const socketPath = path.join(
    os.tmpdir(),
    `growful-codex-ipc-test-${process.pid}-${Date.now()}-${Math.random()}.sock`,
  );
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const decoder = new FrameDecoder((message) => onMessage(message, socket));
    socket.on("data", (chunk) => decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });

  servers.add(server);
  return { server, socketPath };
}

function write(socket: net.Socket, message: CodexIpcMessage): void {
  socket.write(encodeMessage(message));
}

function isRequest(message: CodexIpcMessage): message is CodexIpcRequestMessage {
  return message.type === "request";
}

describe("CodexIpcClient", () => {
  it("connects and initializes with a returned client id", async () => {
    const { socketPath } = await createIpcTestServer((message, socket) => {
      assert.equal(message.type, "request");
      if (!isRequest(message)) {
        return;
      }

      assert.equal(message.type, "request");
      assert.equal(message.method, "initialize");
      assert.equal(message.version, 1);
      assert.deepEqual(message.params, { clientType: "test-client" });
      write(socket, {
        type: "response",
        requestId: message.requestId,
        resultType: "success",
        method: "initialize",
        handledByClientId: "router-1",
        result: { clientId: "client-1" },
      });
    });

    const client = new CodexIpcClient({ socketPath, clientType: "test-client" });
    await client.connect();

    assert.equal(client.clientId, "client-1");
    await client.close();
  });

  it("prefers explicit request version overrides over default method metadata", async () => {
    const { socketPath } = await createIpcTestServer((message, socket) => {
      if (!isRequest(message)) {
        return;
      }

      if (message.method === "initialize") {
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "initialize",
          result: { clientId: "client-1" },
        });
        return;
      }

      if (message.method === "thread-follower-steer-turn") {
        assert.equal(message.version, 99);
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "thread-follower-steer-turn",
          result: { result: { turnId: "turn-99" } },
        });
      }
    });

    const client = new CodexIpcClient({ socketPath });
    await client.connect();

    const result = await client.steerTurn(
      {
        conversationId: "conversation-1",
        clientUserMessageId: "message-1",
        input: [{ type: "text", text: "hello" }],
        expectedTurnId: "turn-1",
      },
      { version: 99 },
    );

    assert.equal(result.result.turnId, "turn-99");
    await client.close();
  });

  it("emits broadcasts from the router", async () => {
    const received: CodexIpcBroadcastMessage[] = [];
    const { socketPath } = await createIpcTestServer((message, socket) => {
      if (isRequest(message) && message.method === "initialize") {
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "initialize",
          result: { clientId: "client-1" },
        });
        write(socket, {
          type: "broadcast",
          method: "thread-stream-state-changed",
          version: 7,
          params: { conversationId: "conversation-1" },
        });
      }
    });

    const client = new CodexIpcClient({ socketPath });
    client.onBroadcast((message) => received.push(message));

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(received.length, 1);
    assert.equal(received[0].method, "thread-stream-state-changed");
    await client.close();
  });

  it("emits normalized thread state events", async () => {
    const received: ThreadStreamStateChangedEvent[] = [];
    const { socketPath } = await createIpcTestServer((message, socket) => {
      if (isRequest(message) && message.method === "initialize") {
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "initialize",
          result: { clientId: "client-1" },
        });
        write(socket, {
          type: "broadcast",
          method: "thread-stream-state-changed",
          version: 7,
          params: {
            conversationId: "conversation-1",
            hostId: "local",
            change: {
              type: "snapshot",
              revision: 1,
              conversationState: { id: "conversation-1" },
            },
          },
        });
      }
    });

    const client = new CodexIpcClient({ socketPath });
    client.onThreadStateChanged((event) => received.push(event));

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(received.length, 1);
    assert.equal(received[0].conversationId, "conversation-1");
    assert.equal(received[0].kind, "snapshot");
    assert.deepEqual(received[0].snapshot, { id: "conversation-1" });
    await client.close();
  });

  it("responds to discovery requests with canHandle false by default", async () => {
    const discoveryResponses: CodexIpcDiscoveryResponseMessage[] = [];
    const { socketPath } = await createIpcTestServer((message, socket) => {
      if (isRequest(message) && message.method === "initialize") {
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "initialize",
          result: { clientId: "client-1" },
        });
        write(socket, {
          type: "client-discovery-request",
          requestId: "discovery-1",
          request: { method: "thread-follower-start-turn" },
        });
      } else if (message.type === "client-discovery-response") {
        discoveryResponses.push(message);
      }
    });

    const client = new CodexIpcClient({ socketPath });
    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(discoveryResponses, [
      {
        type: "client-discovery-response",
        requestId: "discovery-1",
        response: { canHandle: false },
      },
    ]);
    await client.close();
  });

  it("correlates request responses", async () => {
    const { socketPath } = await createIpcTestServer((message, socket) => {
      if (isRequest(message) && message.method === "initialize") {
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "initialize",
          result: { clientId: "client-1" },
        });
      } else if (isRequest(message) && message.method === "thread-follower-steer-turn") {
        assert.equal(message.sourceClientId, "client-1");
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "thread-follower-steer-turn",
          result: { result: { turnId: "turn-1" } },
        });
      }
    });

    const client = new CodexIpcClient({ socketPath });
    await client.connect();

    const result = await client.request("thread-follower-steer-turn", {
      conversationId: "conversation-1",
      clientUserMessageId: "message-1",
      input: [{ type: "text", text: "hello" }],
      expectedTurnId: "turn-1",
    });

    assert.deepEqual(result, { result: { turnId: "turn-1" } });
    await client.close();
  });

  it("provides helper methods for known thread-follower requests", async () => {
    const seenMethods: string[] = [];
    const { socketPath } = await createIpcTestServer((message, socket) => {
      if (isRequest(message) && message.method === "initialize") {
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "initialize",
          result: { clientId: "client-1" },
        });
      } else if (isRequest(message) && message.method === "thread-follower-start-turn") {
        seenMethods.push(message.method);
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "thread-follower-start-turn",
          result: { result: { turn: { id: "turn-1", items: [], itemsView: "summary", status: "inProgress", error: null, startedAt: null, completedAt: null, durationMs: null } } },
        });
      } else if (isRequest(message) && message.method === "thread-follower-steer-turn") {
        seenMethods.push(message.method);
        write(socket, {
          type: "response",
          requestId: message.requestId,
          resultType: "success",
          method: "thread-follower-steer-turn",
          result: { result: { turnId: "turn-1" } },
        });
      }
    });

    const client = new CodexIpcClient({ socketPath });
    await client.connect();

    const startTurnResult = await client.startTurn({
      conversationId: "conversation-1",
      turnStartParams: {
        clientUserMessageId: "message-1",
        input: [{ type: "text", text: "hello" }],
      },
    });
    const steerTurnResult = await client.steerTurn({
      conversationId: "conversation-1",
      clientUserMessageId: "message-2",
      input: [{ type: "text", text: "follow up" }],
      expectedTurnId: "turn-1",
    });

    assert.equal(startTurnResult.result.turn.id, "turn-1");
    assert.equal(steerTurnResult.result.turnId, "turn-1");
    assert.deepEqual(seenMethods, [
      "thread-follower-start-turn",
      "thread-follower-steer-turn",
    ]);
    await client.close();
  });
});

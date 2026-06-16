import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  CodexIpcThreadSender,
  CommandCodexThreadSender,
  OutboxCodexThreadSender,
  UnavailableCodexThreadSender,
} from "../src/sender/codexThreadSender.js";

describe("Codex thread senders", () => {
  it("unavailable sender fails clearly", async () => {
    const sender = new UnavailableCodexThreadSender("No Codex thread-send command is configured.");

    await expect(sender.sendMessage({ threadId: "thread-1", message: "hello" })).rejects.toThrow(
      "No Codex thread-send command is configured.",
    );
  });

  it("outbox sender writes a due message for inspection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reminder-mcp-"));
    try {
      const sender = new OutboxCodexThreadSender(dir);

      await sender.sendMessage({ threadId: "thread-1", message: "hello" });

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const body = JSON.parse(await readFile(join(dir, files[0]), "utf8"));
      expect(body.threadId).toBe("thread-1");
      expect(body.message).toBe("hello");
      expect(body.incompleteFallback).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("command sender sends JSON stdin and thread id env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reminder-mcp-"));
    try {
      const outputPath = join(dir, "command-output.json");
      const sender = new CommandCodexThreadSender(process.execPath, [
        "-e",
        `
          const { writeFileSync } = require("node:fs");
          let stdin = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => { stdin += chunk; });
          process.stdin.on("end", () => {
            writeFileSync(process.argv[1], JSON.stringify({
              stdin,
              threadId: process.env.CODEX_THREAD_ID
            }));
          });
        `,
        outputPath,
      ]);

      await sender.sendMessage({ threadId: "thread-1", message: "hello" });

      const body = JSON.parse(await readFile(outputPath, "utf8"));
      expect(JSON.parse(body.stdin)).toEqual({ threadId: "thread-1", message: "hello" });
      expect(body.threadId).toBe("thread-1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("command sender rejects non-zero exits with stderr", async () => {
    const sender = new CommandCodexThreadSender(process.execPath, [
      "-e",
      `
        process.stderr.write("delivery failed\\n");
        process.exit(42);
      `,
    ]);

    await expect(sender.sendMessage({ threadId: "thread-1", message: "hello" })).rejects.toThrow(
      "Codex thread-send command exited with code 42: delivery failed",
    );
  });

  it("IPC sender initializes and starts an idle thread turn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reminder-mcp-ipc-"));
    const socketPath = join(dir, "ipc.sock");
    const received: unknown[] = [];
    const server = createServer((socket) => {
      readFrames(socket, (message) => {
        received.push(message);
        if (isRequest(message, "initialize")) {
          writeFrame(socket, {
            type: "response",
            requestId: message.requestId,
            result: { clientId: "client-1" },
          });
          writeFrame(socket, {
            type: "client-discovery-request",
            requestId: "discovery-1",
          });
          return;
        }

        if (isRequest(message, "thread-follower-start-turn")) {
          writeFrame(socket, {
            type: "response",
            requestId: message.requestId,
            result: { turn: { id: "turn-1" } },
          });
        }
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      const sender = new CodexIpcThreadSender({
        socketPath,
        cwd: "/Users/johjun/Documents/growful",
        timeoutMs: 1_000,
      });

      await sender.sendMessage({ threadId: "conversation-1", message: "time to check the plants" });

      expect(received).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "request",
            method: "initialize",
            params: { clientType: "reminder-mcp" },
          }),
          expect.objectContaining({
            type: "client-discovery-response",
            requestId: "discovery-1",
            response: { canHandle: false },
          }),
          expect.objectContaining({
            type: "request",
            sourceClientId: "client-1",
            version: 1,
            method: "thread-follower-start-turn",
            params: {
              conversationId: "conversation-1",
              turnStartParams: expect.objectContaining({
                input: [{ type: "text", text: "time to check the plants" }],
                cwd: "/Users/johjun/Documents/growful",
              }),
            },
            timeoutMs: 1_000,
          }),
        ]),
      );
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("IPC sender rejects start-turn responses without a turn id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reminder-mcp-ipc-"));
    const socketPath = join(dir, "ipc.sock");
    const server = createServer((socket) => {
      readFrames(socket, (message) => {
        if (isRequest(message, "initialize")) {
          writeFrame(socket, {
            type: "response",
            requestId: message.requestId,
            result: { clientId: "client-1" },
          });
          return;
        }

        if (isRequest(message, "thread-follower-start-turn")) {
          writeFrame(socket, {
            type: "response",
            requestId: message.requestId,
            result: {},
          });
        }
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      const sender = new CodexIpcThreadSender({ socketPath, timeoutMs: 1_000 });

      await expect(sender.sendMessage({ threadId: "conversation-1", message: "hello" })).rejects.toThrow(
        "Codex IPC start-turn response did not include turn.id.",
      );
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("IPC sender rejects malformed JSON frames without crashing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reminder-mcp-ipc-"));
    const socketPath = join(dir, "ipc.sock");
    const server = createServer((socket) => {
      readFrames(socket, (message) => {
        if (isRequest(message, "initialize")) {
          writeMalformedFrame(socket);
        }
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      const sender = new CodexIpcThreadSender({ socketPath, timeoutMs: 1_000 });

      await expect(sender.sendMessage({ threadId: "conversation-1", message: "hello" })).rejects.toThrow(
        "Codex IPC received malformed JSON frame.",
      );
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function isRequest(message: unknown, method: string): message is { requestId: string; method: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "request" &&
    "requestId" in message &&
    typeof message.requestId === "string" &&
    "method" in message &&
    message.method === method
  );
}

function readFrames(socket: Socket, onMessage: (message: unknown) => void): void {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) {
        return;
      }
      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      onMessage(JSON.parse(body.toString("utf8")));
    }
  });
}

function writeFrame(socket: Socket, message: unknown): void {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

function writeMalformedFrame(socket: Socket): void {
  const body = Buffer.from("{not-json", "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  socket.write(Buffer.concat([header, body]));
}

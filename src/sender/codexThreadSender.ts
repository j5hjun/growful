import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CodexThreadSender } from "../types.js";

type SendMessageInput = Parameters<CodexThreadSender["sendMessage"]>[0];

export class UnavailableCodexThreadSender implements CodexThreadSender {
  constructor(private readonly reason: string) {}

  async sendMessage(_input: SendMessageInput): Promise<void> {
    throw new Error(this.reason);
  }
}

export class OutboxCodexThreadSender implements CodexThreadSender {
  constructor(private readonly outboxDir: string) {}

  async sendMessage(input: SendMessageInput): Promise<void> {
    await mkdir(this.outboxDir, { recursive: true });

    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    const body = {
      threadId: input.threadId,
      message: input.message,
      incompleteFallback: true,
      createdAt: new Date().toISOString(),
    };

    await writeFile(join(this.outboxDir, fileName), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }
}

export class CommandCodexThreadSender implements CodexThreadSender {
  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
  ) {}

  async sendMessage(input: SendMessageInput): Promise<void> {
    const payload = JSON.stringify(input);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        env: {
          ...process.env,
          CODEX_THREAD_ID: input.threadId,
        },
        stdio: ["pipe", "ignore", "pipe"],
      });

      let stderr = "";

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`Codex thread-send command exited with code ${code}${suffix}`));
      });

      child.stdin.end(`${payload}\n`);
    });
  }
}

export interface CodexIpcThreadSenderOptions {
  socketPath?: string;
  cwd?: string;
  timeoutMs?: number;
  clientType?: string;
}

export class CodexIpcThreadSender implements CodexThreadSender {
  private readonly socketPath: string;
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly clientType: string;

  constructor(options: CodexIpcThreadSenderOptions = {}) {
    this.socketPath = options.socketPath ?? defaultCodexIpcSocketPath();
    this.cwd = options.cwd ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.clientType = options.clientType ?? "reminder-mcp";
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    const client = await IpcClient.connect(this.socketPath, this.timeoutMs);
    try {
      const init = await client.request("initialize", { clientType: this.clientType });
      const clientId = readClientId(init);
      await client.request(
        "thread-follower-start-turn",
        {
          conversationId: input.threadId,
          turnStartParams: {
            clientUserMessageId: randomUUID(),
            input: [{ type: "text", text: input.message }],
            cwd: this.cwd,
          },
        },
        clientId,
      ).then(readStartedTurnId);
    } finally {
      client.close();
    }
  }
}

export function defaultCodexIpcSocketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : userInfo().uid;
  return join(tmpdir(), "codex-ipc", `ipc-${uid}.sock`);
}

class IpcClient {
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private buffer = Buffer.alloc(0);

  private constructor(
    private readonly socket: Socket,
    private readonly timeoutMs: number,
  ) {
    this.socket.on("data", (chunk) => this.onData(chunk));
    this.socket.on("error", (error) => this.rejectAll(error));
    this.socket.on("close", () => this.rejectAll(new Error("Codex IPC socket closed before response.")));
  }

  static async connect(socketPath: string, timeoutMs: number): Promise<IpcClient> {
    const socket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    return new IpcClient(socket, timeoutMs);
  }

  async request(method: string, params: unknown, sourceClientId?: string): Promise<unknown> {
    const requestId = randomUUID();
    const request = {
      type: "request",
      requestId,
      ...(sourceClientId ? { sourceClientId, version: 1, timeoutMs: this.timeoutMs } : {}),
      method,
      params,
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Codex IPC request timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });

    this.write(request);
    return promise;
  }

  close(): void {
    this.socket.end();
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < 4 + length) {
        return;
      }
      const body = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      try {
        this.handleMessage(JSON.parse(body.toString("utf8")));
      } catch (cause) {
        const error = new Error("Codex IPC received malformed JSON frame.", { cause });
        this.rejectAll(error);
        this.socket.destroy(error);
        return;
      }
    }
  }

  private handleMessage(message: unknown): void {
    if (isClientDiscoveryRequest(message)) {
      this.write({
        type: "client-discovery-response",
        requestId: message.requestId,
        response: { canHandle: false },
      });
      return;
    }

    if (!isResponse(message)) {
      return;
    }

    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if ("error" in message && message.error) {
      pending.reject(new Error(`Codex IPC request failed: ${JSON.stringify(message.error)}`));
      return;
    }
    pending.resolve(message.result);
  }

  private write(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    this.socket.write(Buffer.concat([header, body]));
  }

  private rejectAll(error: Error): void {
    for (const [requestId, pending] of this.pending) {
      this.pending.delete(requestId);
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}

function readClientId(result: unknown): string {
  if (
    typeof result === "object" &&
    result !== null &&
    "clientId" in result &&
    typeof result.clientId === "string" &&
    result.clientId
  ) {
    return result.clientId;
  }
  throw new Error("Codex IPC initialize response did not include clientId.");
}

function readStartedTurnId(result: unknown): string {
  if (
    typeof result === "object" &&
    result !== null &&
    "turn" in result &&
    typeof result.turn === "object" &&
    result.turn !== null &&
    "id" in result.turn &&
    typeof result.turn.id === "string" &&
    result.turn.id
  ) {
    return result.turn.id;
  }
  throw new Error("Codex IPC start-turn response did not include turn.id.");
}

function isClientDiscoveryRequest(message: unknown): message is { requestId: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "client-discovery-request" &&
    "requestId" in message &&
    typeof message.requestId === "string"
  );
}

function isResponse(message: unknown): message is { requestId: string; result?: unknown; error?: unknown } {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "response" &&
    "requestId" in message &&
    typeof message.requestId === "string"
  );
}

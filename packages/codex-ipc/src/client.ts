import { EventEmitter } from "node:events";
import net from "node:net";
import { randomUUID } from "node:crypto";

import { encodeMessage, FrameDecoder } from "./framing.ts";
import type {
  ThreadFollowerStartTurnParams,
  ThreadFollowerStartTurnResponse,
  ThreadFollowerSteerTurnParams,
  ThreadFollowerSteerTurnResponse,
} from "./model/thread-follower.ts";
import type { IpcMethod } from "./protocol/method-map.ts";
import { getDefaultCodexIpcSocketPath } from "./socket-path.ts";
import { toThreadStreamStateChangedEvent } from "./thread-state.ts";
import type {
  CodexIpcBroadcastMessage,
  CodexIpcMessage,
  CodexIpcRequestParams,
  CodexIpcRequestResult,
  CodexIpcRequestMessage,
  CodexIpcResponseMessage,
  ThreadStreamStateChangedEvent,
} from "./types.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export interface CodexIpcClientOptions {
  socketPath?: string;
  clientType?: string;
}

export interface CodexIpcRequestOptions {
  includeSourceClientId?: boolean;
  requestId?: string;
  timeoutMs?: number;
  version?: number;
}

interface PendingRequest {
  method: IpcMethod;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function isInitializeResult(result: unknown): result is { clientId: string } {
  return (
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    typeof (result as { clientId?: unknown }).clientId === "string"
  );
}

export class CodexIpcClient {
  #socketPath: string;
  #clientType: string;
  #socket: net.Socket | null = null;
  #events = new EventEmitter();
  #pending = new Map<string, PendingRequest>();

  clientId: string | null = null;

  constructor(options: CodexIpcClientOptions = {}) {
    this.#socketPath = options.socketPath ?? getDefaultCodexIpcSocketPath();
    this.#clientType = options.clientType ?? "growful-codex-ipc";
  }

  async connect(): Promise<void> {
    if (this.#socket !== null) {
      return;
    }

    const socket = net.createConnection({ path: this.#socketPath });
    this.#socket = socket;
    const decoder = new FrameDecoder((message) => this.#handleMessage(message));

    socket.on("data", (chunk) => decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on("close", () => this.#rejectPending(new Error("codex-ipc socket closed")));
    socket.on("error", (error) => this.#rejectPending(error));

    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const result = await this.request("initialize", { clientType: this.#clientType }, {
      includeSourceClientId: false,
      requestId: "initialize",
    });

    if (!isInitializeResult(result)) {
      throw new Error("codex-ipc initialize response did not include a client id");
    }

    this.clientId = result.clientId;
  }

  async close(): Promise<void> {
    const socket = this.#socket;
    this.#socket = null;

    if (socket === null) {
      return;
    }

    await new Promise((resolve) => {
      socket.once("close", resolve);
      socket.end();
    });
  }

  onBroadcast(handler: (message: CodexIpcBroadcastMessage) => void): () => void {
    this.#events.on("broadcast", handler);
    return () => this.#events.off("broadcast", handler);
  }

  onThreadStateChanged(handler: (event: ThreadStreamStateChangedEvent) => void): () => void {
    this.#events.on("thread-state-changed", handler);
    return () => this.#events.off("thread-state-changed", handler);
  }

  async request<Method extends IpcMethod>(
    method: Method,
    params: CodexIpcRequestParams<Method>,
    options: CodexIpcRequestOptions = {},
  ): Promise<CodexIpcRequestResult<Method>> {
    const socket = this.#requireSocket();
    const requestId = options.requestId ?? randomUUID();
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    const message: CodexIpcRequestMessage<Method> = {
      type: "request",
      requestId,
      method,
      params,
      ...(options.includeSourceClientId === false ? {} : { sourceClientId: this.clientId }),
      ...(options.version === undefined ? {} : { version: options.version }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs }),
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`codex-ipc request timed out: ${method}`));
      }, timeoutMs);

      this.#pending.set(requestId, { method, resolve, reject, timeout });
    });

    socket.write(encodeMessage(message));
    return promise as Promise<CodexIpcRequestResult<Method>>;
  }

  startTurn(
    params: ThreadFollowerStartTurnParams,
    options: CodexIpcRequestOptions = {},
  ): Promise<ThreadFollowerStartTurnResponse> {
    return this.request("thread-follower-start-turn", params, options);
  }

  steerTurn(
    params: ThreadFollowerSteerTurnParams,
    options: CodexIpcRequestOptions = {},
  ): Promise<ThreadFollowerSteerTurnResponse> {
    return this.request("thread-follower-steer-turn", params, options);
  }

  #handleMessage(message: CodexIpcMessage): void {
    if (message.type === "response") {
      this.#handleResponse(message);
      return;
    }

    if (message.type === "broadcast") {
      this.#events.emit("broadcast", message);
      const event = toThreadStreamStateChangedEvent(message);
      if (event !== null) {
        this.#events.emit("thread-state-changed", event);
      }
      return;
    }

    if (message.type === "client-discovery-request") {
      this.#respondToDiscovery(message.requestId, false);
    }
  }

  #handleResponse(message: CodexIpcResponseMessage): void {
    const pending = this.#pending.get(message.requestId);
    if (pending === undefined) {
      return;
    }

    clearTimeout(pending.timeout);
    this.#pending.delete(message.requestId);

    if (message.resultType === "error") {
      pending.reject(new Error(message.error ?? `codex-ipc request failed: ${pending.method}`));
      return;
    }

    pending.resolve(message.result);
  }

  #respondToDiscovery(requestId: string | null | undefined, canHandle: boolean): void {
    const socket = this.#socket;
    if (socket === null || requestId == null) {
      return;
    }

    socket.write(
      encodeMessage({
        type: "client-discovery-response",
        requestId,
        response: { canHandle },
      }),
    );
  }

  #requireSocket(): net.Socket {
    if (this.#socket === null) {
      throw new Error("CodexIpcClient is not connected");
    }

    return this.#socket;
  }

  #rejectPending(error: Error): void {
    for (const [requestId, pending] of this.#pending) {
      clearTimeout(pending.timeout);
      this.#pending.delete(requestId);
      pending.reject(error);
    }
  }
}

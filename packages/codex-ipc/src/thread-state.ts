import type {
  CodexIpcBroadcastMessage,
  CodexIpcMessage,
  JsonObject,
  JsonValue,
  ThreadStreamStateChangedEvent,
} from "./types.ts";

export function isThreadStreamStateChangedBroadcast(
  message: CodexIpcMessage | null | undefined,
): message is CodexIpcBroadcastMessage {
  return message?.type === "broadcast" && message.method === "thread-stream-state-changed";
}

function asObject(value: JsonValue | undefined): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function toThreadStreamStateChangedEvent(
  message: CodexIpcMessage,
): ThreadStreamStateChangedEvent | null {
  if (!isThreadStreamStateChangedBroadcast(message)) {
    return null;
  }

  const params = message.params ?? {};
  const change = asObject(params.change);
  const changeType = asString(change.type);

  return {
    conversationId: asString(params.conversationId),
    hostId: asString(params.hostId),
    sourceClientId: message.sourceClientId ?? null,
    version: message.version ?? null,
    changeType,
    revision: asNumber(change.revision),
    baseRevision: asNumber(change.baseRevision),
    snapshot: changeType === "snapshot" ? (change.conversationState ?? null) : null,
    patches: changeType === "patches" ? asArray(change.patches) : null,
    raw: message,
  };
}

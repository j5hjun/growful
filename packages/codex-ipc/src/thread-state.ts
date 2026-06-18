import type {
  CodexIpcBroadcastMessage,
  CodexIpcMessage,
  JsonObject,
  JsonValue,
  ThreadStreamStateChangedEvent,
} from "./types.ts";

export function isThreadStreamStateChangedBroadcast(
  message: CodexIpcMessage | null | undefined,
): message is CodexIpcBroadcastMessage<"thread-stream-state-changed"> {
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
  const base = {
    conversationId: asString(params.conversationId),
    hostId: asString(params.hostId),
    sourceClientId: message.sourceClientId ?? null,
    version: message.version ?? null,
    revision: asNumber(change.revision),
    baseRevision: asNumber(change.baseRevision),
    raw: message,
  };

  if (changeType === "snapshot") {
    return {
      ...base,
      kind: "snapshot",
      snapshot: change.conversationState ?? null,
    };
  }

  if (changeType === "patches") {
    return {
      ...base,
      kind: "patches",
      patches: asArray(change.patches),
    };
  }

  return {
    ...base,
    kind: "unknown",
    changeType,
  };
}

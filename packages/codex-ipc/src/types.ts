import type {
  IpcMethod,
  IpcMethodMap,
  IpcRequestParamsForMethod,
  IpcResultForMethod,
} from "./protocol/method-map.ts";
import type { ByteRange, ImageDetail, TextElement, UserInput } from "./model/input.ts";
import type {
  ThreadFollowerStartTurnParams,
  ThreadFollowerStartTurnResponse,
  ThreadFollowerSteerTurnParams,
  ThreadFollowerSteerTurnResponse,
  ThreadFollowerTurnStartParams,
} from "./model/thread-follower.ts";
import type {
  Turn,
  TurnError,
  TurnItemsView,
  TurnStartParams,
  TurnStartResponse,
  TurnStatus,
  TurnSteerParams,
  TurnSteerResponse,
} from "./model/turn.ts";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type CodexIpcRequestParamsByMethod = {
  [Method in IpcMethod]: IpcRequestParamsForMethod<Method>;
};

export type CodexIpcRequestResultByMethod = {
  [Method in IpcMethod]: IpcResultForMethod<Method>;
};

export type CodexIpcRequestMethod = keyof IpcMethodMap;

export type CodexIpcRequestParams<Method extends string> =
  Method extends IpcMethod ? IpcRequestParamsForMethod<Method> : JsonObject;

export type CodexIpcRequestResult<Method extends string> =
  Method extends IpcMethod ? IpcResultForMethod<Method> : JsonValue | undefined;

export interface CodexIpcRequestMessage<
  Method extends string = string,
  Params = CodexIpcRequestParams<Method>,
> {
  type: "request";
  requestId: string;
  method: Method;
  params: Params;
  sourceClientId?: string | null;
  version?: number;
  timeoutMs?: number;
}

export interface CodexIpcResponseMessage<
  Method extends string = string,
  Result = Method extends CodexIpcRequestMethod ? CodexIpcRequestResult<Method> : unknown,
> {
  type: "response";
  requestId: string;
  method?: Method;
  handledByClientId?: string;
  resultType: "success" | "error";
  result?: Result;
  error?: string;
}

export interface CodexIpcBroadcastMessage<
  Method extends string = string,
  Params extends JsonObject | undefined = JsonObject | undefined,
> {
  type: "broadcast";
  method: Method;
  params?: Params;
  sourceClientId?: string | null;
  version?: number;
}

export interface CodexIpcDiscoveryRequestMessage {
  type: "client-discovery-request";
  requestId?: string | null;
  request?: JsonObject;
}

export interface CodexIpcDiscoveryResponseMessage {
  type: "client-discovery-response";
  requestId: string;
  response: { canHandle: boolean };
}

export type CodexIpcMessage =
  | CodexIpcRequestMessage<string, unknown>
  | CodexIpcResponseMessage<string, unknown>
  | CodexIpcBroadcastMessage<string, JsonObject | undefined>
  | CodexIpcDiscoveryRequestMessage
  | CodexIpcDiscoveryResponseMessage;

interface ThreadStreamStateChangedEventBase {
  conversationId: string | null;
  hostId: string | null;
  sourceClientId: string | null;
  version: number | null;
  revision: number | null;
  baseRevision: number | null;
  raw: CodexIpcBroadcastMessage<"thread-stream-state-changed">;
}

export type ThreadStreamStateChangedEvent =
  | (ThreadStreamStateChangedEventBase & {
      kind: "snapshot";
      snapshot: JsonValue | null;
    })
  | (ThreadStreamStateChangedEventBase & {
      kind: "patches";
      patches: JsonValue[];
    })
  | (ThreadStreamStateChangedEventBase & {
      kind: "unknown";
      changeType: string | null;
    });

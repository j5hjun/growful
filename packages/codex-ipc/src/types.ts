export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ImageDetail = "auto" | "low" | "high" | "original";

export interface ByteRange {
  start: number;
  end: number;
}

export interface TextElement {
  byteRange: ByteRange;
  placeholder: string | null;
}

export type UserInput =
  | {
      type: "text";
      text: string;
      text_elements?: TextElement[];
    }
  | {
      type: "image";
      detail?: ImageDetail;
      url: string;
    }
  | {
      type: "localImage";
      detail?: ImageDetail;
      path: string;
    }
  | {
      type: "skill";
      name: string;
      path: string;
    }
  | {
      type: "mention";
      name: string;
      path: string;
    };

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";
export type TurnItemsView = "notLoaded" | "summary" | "full";

export interface TurnError {
  message: string;
  codexErrorInfo: unknown | null;
  additionalDetails: string | null;
}

export interface Turn {
  id: string;
  items: unknown[];
  itemsView: TurnItemsView;
  status: TurnStatus;
  error: TurnError | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface TurnStartParams {
  threadId: string;
  clientUserMessageId?: string | null;
  input: UserInput[];
  responsesapiClientMetadata?: Record<string, string> | null;
  additionalContext?: Record<string, unknown> | null;
  environments?: unknown[] | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  approvalPolicy?: unknown | null;
  approvalsReviewer?: unknown | null;
  sandboxPolicy?: unknown | null;
  permissions?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  effort?: string | null;
  summary?: string | null;
  personality?: unknown | null;
  outputSchema?: JsonValue | null;
  collaborationMode?: unknown | null;
}

export type ThreadFollowerTurnStartParams = Omit<TurnStartParams, "threadId">;

export interface TurnStartResponse {
  turn: Turn;
}

export interface ThreadFollowerStartTurnParams {
  conversationId: string;
  turnStartParams: ThreadFollowerTurnStartParams;
}

export interface ThreadFollowerStartTurnResponse {
  result: TurnStartResponse;
}

export interface TurnSteerParams {
  threadId: string;
  clientUserMessageId?: string | null;
  input: UserInput[];
  responsesapiClientMetadata?: Record<string, string> | null;
  additionalContext?: Record<string, unknown> | null;
  expectedTurnId: string;
}

export type ThreadFollowerSteerTurnParams = Omit<TurnSteerParams, "threadId"> & {
  conversationId: string;
  restoreMessage?: unknown;
  serviceTier?: string | null;
  attachments?: unknown[];
};

export interface TurnSteerResponse {
  turnId: string;
}

export interface ThreadFollowerSteerTurnResponse {
  result: TurnSteerResponse;
}

export interface CodexIpcRequestParamsByMethod {
  initialize: { clientType: string };
  "thread-follower-start-turn": ThreadFollowerStartTurnParams;
  "thread-follower-steer-turn": ThreadFollowerSteerTurnParams;
}

export interface CodexIpcRequestResultByMethod {
  initialize: { clientId: string };
  "thread-follower-start-turn": ThreadFollowerStartTurnResponse;
  "thread-follower-steer-turn": ThreadFollowerSteerTurnResponse;
}

export type CodexIpcKnownRequestMethod = keyof CodexIpcRequestParamsByMethod;

export type CodexIpcRequestParams<Method extends string> =
  Method extends CodexIpcKnownRequestMethod ? CodexIpcRequestParamsByMethod[Method] : JsonObject;

export type CodexIpcRequestResult<Method extends string> =
  Method extends keyof CodexIpcRequestResultByMethod
    ? CodexIpcRequestResultByMethod[Method]
    : JsonValue | undefined;

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

export interface CodexIpcResponseMessage {
  type: "response";
  requestId: string;
  method?: string;
  resultType: "success" | "error";
  result?: unknown;
  error?: string;
}

export interface CodexIpcBroadcastMessage {
  type: "broadcast";
  method: string;
  params?: JsonObject;
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
  | CodexIpcResponseMessage
  | CodexIpcBroadcastMessage
  | CodexIpcDiscoveryRequestMessage
  | CodexIpcDiscoveryResponseMessage;

export interface ThreadStreamStateChangedEvent {
  conversationId: string | null;
  hostId: string | null;
  sourceClientId: string | null;
  version: number | null;
  changeType: string | null;
  revision: number | null;
  baseRevision: number | null;
  snapshot: JsonValue | null;
  patches: JsonValue[] | null;
  raw: CodexIpcBroadcastMessage;
}

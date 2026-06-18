import { CodexIpcClient } from "../src/client.ts";
// @ts-expect-error detailed protocol types should not be exported from the root entrypoint.
import type { CodexIpcRequestMethod as RootCodexIpcRequestMethod } from "../src/index.ts";
import type {
  CodexIpcBroadcastMessage,
  CodexIpcRequestMethod,
  CodexIpcRequestParamsByMethod,
  CodexIpcRequestResultByMethod,
  CodexIpcResponseMessage,
  IpcBroadcastMap,
  IpcMethodMap,
} from "../src/protocol.ts";
import type {
  ThreadFollowerStartTurnResponse,
  TurnStartParams,
  UserInput,
} from "../src/model.ts";
import type { UserInput as SplitUserInput } from "../src/model/input.ts";
import type { TurnStartParams as SplitTurnStartParams } from "../src/model/turn.ts";
import type {
  ThreadFollowerStartTurnResponse as SplitThreadFollowerStartTurnResponse,
} from "../src/model/thread-follower.ts";

type Assert<T extends true> = T;
type IsAssignable<Left, Right> = Left extends Right ? true : false;

type StartTurnParamsMapEntryIsStable = Assert<
  IsAssignable<
    CodexIpcRequestParamsByMethod["thread-follower-start-turn"],
    {
      conversationId: string;
      turnStartParams: object;
    }
  >
>;

type StartTurnResultMapEntryIsStable = Assert<
  IsAssignable<
    CodexIpcRequestResultByMethod["thread-follower-start-turn"],
    {
      result: object;
    }
  >
>;

type MethodMapIncludesInitialize = Assert<
  IsAssignable<"initialize", keyof IpcMethodMap>
>;

type PublicRequestMethodIncludesInitialize = Assert<
  IsAssignable<"initialize", CodexIpcRequestMethod>
>;

type InitializeVersionIsDeclared = Assert<
  IsAssignable<1, IpcMethodMap["initialize"]["version"]>
>;

type ThreadStateBroadcastCarriesTypedEnvelope = Assert<
  IsAssignable<
    IpcBroadcastMap["thread-stream-state-changed"]["params"],
    {
      conversationId?: string | null;
      hostId?: string | null;
      change?: {
        type?: string | null;
      };
    }
  >
>;

type ThreadStateBroadcastChangePayloadIsTyped = Assert<
  IsAssignable<
    IpcBroadcastMap["thread-stream-state-changed"]["params"]["change"],
    {
      type?: string | null;
      revision?: number;
    } | undefined
  >
>;

type ClientStatusBroadcastCarriesTypedStatus = Assert<
  IsAssignable<
    IpcBroadcastMap["client-status-changed"]["params"],
    {
      clientId: string;
      clientType: string;
      status: string;
    }
  >
>;

type UserInputMatchesModel = Assert<
  IsAssignable<UserInput, SplitUserInput> extends true
    ? IsAssignable<SplitUserInput, UserInput>
    : false
>;

type TurnStartParamsMatchModel = Assert<
  IsAssignable<TurnStartParams, SplitTurnStartParams> extends true
    ? IsAssignable<SplitTurnStartParams, TurnStartParams>
    : false
>;

type StartTurnResponseMatchesModel = Assert<
  IsAssignable<
    ThreadFollowerStartTurnResponse,
    SplitThreadFollowerStartTurnResponse
  > extends true
    ? IsAssignable<
        SplitThreadFollowerStartTurnResponse,
        ThreadFollowerStartTurnResponse
      >
    : false
>;

const initializeResponseMessage: CodexIpcResponseMessage<"initialize"> = {
  type: "response",
  requestId: "request-1",
  method: "initialize",
  resultType: "success",
  handledByClientId: "client-1",
  result: { clientId: "client-2" },
};

const threadStateBroadcast: CodexIpcBroadcastMessage<
  "thread-stream-state-changed",
  { conversationId: string }
> = {
  type: "broadcast",
  method: "thread-stream-state-changed",
  params: { conversationId: "conversation-1" },
};

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

const helperStartTurnResult: Promise<ThreadFollowerStartTurnResponse> = client.startTurn({
  conversationId: "conversation-1",
  turnStartParams: {
    clientUserMessageId: "message-1",
    input: [{ type: "text", text: "hello" }],
    cwd: "/workspace/growful",
  },
});

void startTurnResult;
void helperStartTurnResult;
const startTurnParamsMapEntryIsStable: StartTurnParamsMapEntryIsStable = true;
const startTurnResultMapEntryIsStable: StartTurnResultMapEntryIsStable = true;
const methodMapIncludesInitialize: MethodMapIncludesInitialize = true;
const publicRequestMethodIncludesInitialize: PublicRequestMethodIncludesInitialize = true;
const initializeVersionIsDeclared: InitializeVersionIsDeclared = true;
const threadStateBroadcastCarriesTypedEnvelope: ThreadStateBroadcastCarriesTypedEnvelope = true;
const threadStateBroadcastChangePayloadIsTyped: ThreadStateBroadcastChangePayloadIsTyped = true;
const clientStatusBroadcastCarriesTypedStatus: ClientStatusBroadcastCarriesTypedStatus = true;
const userInputMatchesModel: UserInputMatchesModel = true;
const turnStartParamsMatchModel: TurnStartParamsMatchModel = true;
const startTurnResponseMatchesModel: StartTurnResponseMatchesModel = true;

void startTurnParamsMapEntryIsStable;
void startTurnResultMapEntryIsStable;
void methodMapIncludesInitialize;
void publicRequestMethodIncludesInitialize;
void initializeVersionIsDeclared;
void threadStateBroadcastCarriesTypedEnvelope;
void threadStateBroadcastChangePayloadIsTyped;
void clientStatusBroadcastCarriesTypedStatus;
void userInputMatchesModel;
void turnStartParamsMatchModel;
void startTurnResponseMatchesModel;
void initializeResponseMessage;
void threadStateBroadcast;

client.request("thread-follower-steer-turn", {
  conversationId: "conversation-1",
  clientUserMessageId: "message-1",
  input: [{ type: "text", text: "hello" }],
  expectedTurnId: "turn-1",
});

client.steerTurn({
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

// @ts-expect-error typed client requests only accept declared IPC methods.
client.request("example-method", {
  value: 1,
});

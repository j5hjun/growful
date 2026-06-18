import type { InitializeMethod } from "./methods/initialize.ts";
import type { ThreadFollowerStartTurnMethod } from "./methods/thread-follower-start-turn.ts";
import type { ThreadFollowerSteerTurnMethod } from "./methods/thread-follower-steer-turn.ts";

export interface IpcMethodMap {
  initialize: InitializeMethod;
  "thread-follower-start-turn": ThreadFollowerStartTurnMethod;
  "thread-follower-steer-turn": ThreadFollowerSteerTurnMethod;
}

export type IpcMethod = keyof IpcMethodMap;

export type IpcRequestParamsForMethod<Method extends IpcMethod> = IpcMethodMap[Method]["params"];

export type IpcResultForMethod<Method extends IpcMethod> = IpcMethodMap[Method]["result"];

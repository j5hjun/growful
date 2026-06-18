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

export type IpcMethodVersion<Method extends IpcMethod> = IpcMethodMap[Method]["version"];

export function getIpcMethodVersion<Method extends IpcMethod>(method: Method): IpcMethodVersion<Method> {
  switch (method) {
    case "initialize":
    case "thread-follower-start-turn":
    case "thread-follower-steer-turn":
      return 1 as IpcMethodVersion<Method>;
  }
}

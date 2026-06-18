import type {
  ClientStatusChangedParams,
  ThreadStreamStateChangedParams,
} from "../model/broadcast.ts";

export interface IpcBroadcastDescriptor<Params, Version extends number = number> {
  params: Params;
  version: Version;
}

export interface IpcBroadcastMap {
  "thread-stream-state-changed": IpcBroadcastDescriptor<ThreadStreamStateChangedParams, 1>;
  "client-status-changed": IpcBroadcastDescriptor<ClientStatusChangedParams, 1>;
}

export type IpcBroadcastMethod = keyof IpcBroadcastMap;

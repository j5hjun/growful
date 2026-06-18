import type {
  ThreadFollowerSteerTurnParams,
  ThreadFollowerSteerTurnResponse,
} from "../../model/thread-follower.ts";

import type { IpcMethodDescriptor } from "./descriptor.ts";

export type ThreadFollowerSteerTurnMethod = IpcMethodDescriptor<
  ThreadFollowerSteerTurnParams,
  ThreadFollowerSteerTurnResponse
>;

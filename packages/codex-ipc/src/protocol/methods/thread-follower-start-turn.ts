import type {
  ThreadFollowerStartTurnParams,
  ThreadFollowerStartTurnResponse,
} from "../../model/thread-follower.ts";

import type { IpcMethodDescriptor } from "./descriptor.ts";

export type ThreadFollowerStartTurnMethod = IpcMethodDescriptor<
  ThreadFollowerStartTurnParams,
  ThreadFollowerStartTurnResponse
>;

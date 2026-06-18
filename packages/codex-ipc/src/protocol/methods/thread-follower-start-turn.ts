import type {
  ThreadFollowerStartTurnParams,
  ThreadFollowerStartTurnResponse,
} from "../../model/thread-follower.ts";

import type { IpcMethodDescriptor } from "./descriptor.ts";

export interface ThreadFollowerStartTurnMethod
  extends IpcMethodDescriptor<
    ThreadFollowerStartTurnParams,
    ThreadFollowerStartTurnResponse,
    1
  > {
  version: 1;
}

import type {
  ThreadFollowerSteerTurnParams,
  ThreadFollowerSteerTurnResponse,
} from "../../model/thread-follower.ts";

import type { IpcMethodDescriptor } from "./descriptor.ts";

export interface ThreadFollowerSteerTurnMethod
  extends IpcMethodDescriptor<
    ThreadFollowerSteerTurnParams,
    ThreadFollowerSteerTurnResponse,
    1
  > {
  version: 1;
}

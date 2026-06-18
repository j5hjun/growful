import type {
  TurnStartParams,
  TurnStartResponse,
  TurnSteerParams,
  TurnSteerResponse,
} from "./turn.ts";

export type ThreadFollowerTurnStartParams = Omit<TurnStartParams, "threadId">;

export interface ThreadFollowerStartTurnParams {
  conversationId: string;
  turnStartParams: ThreadFollowerTurnStartParams;
}

export interface ThreadFollowerStartTurnResponse {
  result: TurnStartResponse;
}

export type ThreadFollowerSteerTurnParams = Omit<TurnSteerParams, "threadId"> & {
  conversationId: string;
  restoreMessage?: unknown;
  serviceTier?: string | null;
  attachments?: unknown[];
};

export interface ThreadFollowerSteerTurnResponse {
  result: TurnSteerResponse;
}

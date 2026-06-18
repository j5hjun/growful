import type { JsonValue } from "../types.ts";

import type { UserInput } from "./input.ts";

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

export interface TurnStartResponse {
  turn: Turn;
}

export interface TurnSteerParams {
  threadId: string;
  clientUserMessageId?: string | null;
  input: UserInput[];
  responsesapiClientMetadata?: Record<string, string> | null;
  additionalContext?: Record<string, unknown> | null;
  expectedTurnId: string;
}

export interface TurnSteerResponse {
  turnId: string;
}

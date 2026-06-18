import type { JsonValue } from "../types.ts";

export interface ThreadStreamSnapshotChange {
  type?: "snapshot" | string | null;
  revision?: number;
  baseRevision?: number;
  conversationState?: JsonValue;
}

export interface ThreadStreamPatchesChange {
  type?: "patches" | string | null;
  revision?: number;
  baseRevision?: number;
  patches?: JsonValue[];
}

export type ThreadStreamUnknownChange = {
  type?: string | null;
  revision?: number;
  baseRevision?: number;
};

export type ThreadStreamChange =
  | ThreadStreamSnapshotChange
  | ThreadStreamPatchesChange
  | ThreadStreamUnknownChange;

export interface ThreadStreamStateChangedParams {
  conversationId?: string | null;
  hostId?: string | null;
  change?: ThreadStreamChange;
}

export interface ClientStatusChangedParams {
  clientId: string;
  clientType: string;
  status: string;
}

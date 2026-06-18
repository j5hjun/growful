import type { IpcMethodDescriptor } from "./descriptor.ts";

export interface InitializeParams {
  clientType: string;
}

export interface InitializeResult {
  clientId: string;
}

export type InitializeMethod = IpcMethodDescriptor<InitializeParams, InitializeResult>;

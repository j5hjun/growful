import type { IpcMethodDescriptor } from "./descriptor.ts";

export interface InitializeParams {
  clientType: string;
}

export interface InitializeResult {
  clientId: string;
}

export interface InitializeMethod
  extends IpcMethodDescriptor<InitializeParams, InitializeResult, 1> {
  version: 1;
}

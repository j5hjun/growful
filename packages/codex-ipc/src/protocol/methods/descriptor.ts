export interface IpcMethodDescriptor<Params, Result, Version extends number = number> {
  params: Params;
  result: Result;
  version: Version;
}

import os from "node:os";
import path from "node:path";

export interface CodexIpcSocketPathEnv {
  platform?: NodeJS.Platform | "win32";
  tmpdir?: () => string;
  getuid?: (() => number) | undefined;
}

export function getDefaultCodexIpcSocketPath(env: CodexIpcSocketPathEnv = {}): string {
  const platform = env.platform ?? process.platform;

  if (platform === "win32") {
    return path.win32.join("\\\\.\\pipe", "codex-ipc");
  }

  const tmpdir = env.tmpdir ?? os.tmpdir;
  const getuid = Object.hasOwn(env, "getuid") ? env.getuid : process.getuid;
  const uid = typeof getuid === "function" ? getuid() : null;
  const socketName = uid ? `ipc-${uid}.sock` : "ipc.sock";

  return path.join(tmpdir(), "codex-ipc", socketName);
}

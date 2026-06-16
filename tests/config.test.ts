import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads Codex IPC delivery settings", () => {
    const config = loadConfig({
      XDG_DATA_HOME: "/tmp/data",
      CODEX_THREAD_ID: "thread-1",
      REMINDER_MCP_USE_CODEX_IPC: "1",
      REMINDER_MCP_CODEX_IPC_SOCKET: "/tmp/codex-ipc.sock",
      REMINDER_MCP_CODEX_IPC_CWD: "/Users/johjun/Documents/growful",
      REMINDER_MCP_CODEX_IPC_TIMEOUT_MS: "1234",
    });

    expect(config).toMatchObject({
      threadId: "thread-1",
      useCodexIpc: true,
      codexIpcSocketPath: "/tmp/codex-ipc.sock",
      codexIpcCwd: "/Users/johjun/Documents/growful",
      codexIpcTimeoutMs: 1234,
    });
  });
});

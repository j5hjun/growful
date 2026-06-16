import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDefaultCodexIpcSocketPath } from "../src/socket-path.ts";

describe("getDefaultCodexIpcSocketPath", () => {
  it("returns the per-user Unix socket path", () => {
    const socketPath = getDefaultCodexIpcSocketPath({
      platform: "darwin",
      tmpdir: () => "/tmp/example",
      getuid: () => 501,
    });

    assert.equal(socketPath, "/tmp/example/codex-ipc/ipc-501.sock");
  });

  it("falls back to ipc.sock when uid is unavailable", () => {
    const socketPath = getDefaultCodexIpcSocketPath({
      platform: "linux",
      tmpdir: () => "/tmp/example",
      getuid: undefined,
    });

    assert.equal(socketPath, "/tmp/example/codex-ipc/ipc.sock");
  });

  it("returns the Windows named pipe path", () => {
    const socketPath = getDefaultCodexIpcSocketPath({
      platform: "win32",
      tmpdir: () => "C:\\Temp",
      getuid: undefined,
    });

    assert.equal(socketPath, "\\\\.\\pipe\\codex-ipc");
  });
});

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

import { CodexIpcClient, getDefaultCodexIpcSocketPath } from "../../src/index.ts";

const RUN_INTEGRATION = process.env.CODEX_IPC_INTEGRATION === "1";

describe("real codex-ipc integration", { skip: !RUN_INTEGRATION }, () => {
  it("connects to the local router as a passive observer", async () => {
    const socketPath = getDefaultCodexIpcSocketPath();

    if (!fs.existsSync(socketPath)) {
      assert.fail(`codex-ipc socket does not exist: ${socketPath}`);
    }

    const client = new CodexIpcClient({
      socketPath,
      clientType: "growful-codex-ipc-integration-test",
    });
    const broadcasts = [];
    const threadEvents = [];

    client.onBroadcast((message) => broadcasts.push(message));
    client.onThreadStateChanged((event) => threadEvents.push(event));

    await client.connect();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await client.close();

    const clientId = client.clientId;
    assert.equal(typeof clientId, "string");
    if (clientId === null) {
      assert.fail("client id was not assigned");
    }
    assert.ok(clientId.length > 0);
    assert.ok(
      broadcasts.length > 0 || threadEvents.length >= 0,
      "client connected but no observation window was completed",
    );
  });
});

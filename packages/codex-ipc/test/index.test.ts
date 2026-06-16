import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CodexIpcClient,
  FrameDecoder,
  encodeMessage,
  getDefaultCodexIpcSocketPath,
  isThreadStreamStateChangedBroadcast,
  toThreadStreamStateChangedEvent,
} from "../src/index.ts";

describe("package entrypoint", () => {
  it("exports the public observer API", () => {
    assert.equal(typeof CodexIpcClient, "function");
    assert.equal(typeof FrameDecoder, "function");
    assert.equal(typeof encodeMessage, "function");
    assert.equal(typeof getDefaultCodexIpcSocketPath, "function");
    assert.equal(typeof isThreadStreamStateChangedBroadcast, "function");
    assert.equal(typeof toThreadStreamStateChangedEvent, "function");
  });
});

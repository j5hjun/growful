import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isThreadStreamStateChangedBroadcast,
  toThreadStreamStateChangedEvent,
} from "../src/thread-state.ts";

describe("isThreadStreamStateChangedBroadcast", () => {
  it("matches thread-stream-state-changed broadcasts", () => {
    assert.equal(
      isThreadStreamStateChangedBroadcast({
        type: "broadcast",
        method: "thread-stream-state-changed",
        params: {},
      }),
      true,
    );
  });

  it("rejects other broadcasts", () => {
    assert.equal(
      isThreadStreamStateChangedBroadcast({
        type: "broadcast",
        method: "query-cache-invalidate",
        params: {},
      }),
      false,
    );
  });
});

describe("toThreadStreamStateChangedEvent", () => {
  it("normalizes snapshot broadcasts", () => {
    const event = toThreadStreamStateChangedEvent({
      type: "broadcast",
      method: "thread-stream-state-changed",
      sourceClientId: "source-1",
      version: 7,
      params: {
        conversationId: "conversation-1",
        hostId: "local",
        change: {
          type: "snapshot",
          revision: 12,
          conversationState: { id: "conversation-1" },
        },
      },
    });

    assert.ok(event);
    assert.deepEqual(event, {
      conversationId: "conversation-1",
      hostId: "local",
      sourceClientId: "source-1",
      version: 7,
      changeType: "snapshot",
      revision: 12,
      baseRevision: null,
      snapshot: { id: "conversation-1" },
      patches: null,
      raw: event.raw,
    });
  });

  it("normalizes patch broadcasts", () => {
    const patches = [{ op: "add", path: ["turns", 0], value: { id: "turn-1" } }];
    const event = toThreadStreamStateChangedEvent({
      type: "broadcast",
      method: "thread-stream-state-changed",
      params: {
        conversationId: "conversation-1",
        hostId: "local",
        change: {
          type: "patches",
          revision: 13,
          baseRevision: 12,
          patches,
        },
      },
    });

    assert.ok(event);
    assert.equal(event.changeType, "patches");
    assert.equal(event.revision, 13);
    assert.equal(event.baseRevision, 12);
    assert.equal(event.snapshot, null);
    assert.deepEqual(event.patches, patches);
  });

  it("returns null for unrelated broadcasts", () => {
    assert.equal(
      toThreadStreamStateChangedEvent({
        type: "broadcast",
        method: "client-status-changed",
        params: {},
      }),
      null,
    );
  });
});

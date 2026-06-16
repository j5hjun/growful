import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FrameDecoder, encodeMessage } from "../src/framing.ts";
import type { CodexIpcMessage } from "../src/index.ts";

describe("encodeMessage", () => {
  it("prefixes JSON payloads with a uint32le byte length", () => {
    const frame = encodeMessage({ type: "request", requestId: "1", method: "hello", params: {} });
    const length = frame.readUInt32LE(0);
    const payload = frame.subarray(4).toString("utf8");

    assert.equal(length, Buffer.byteLength(payload));
    assert.deepEqual(JSON.parse(payload), {
      type: "request",
      requestId: "1",
      method: "hello",
      params: {},
    });
  });
});

describe("FrameDecoder", () => {
  it("decodes frames split across chunks", () => {
    const frame = encodeMessage({ type: "broadcast", method: "hello" });
    const messages: CodexIpcMessage[] = [];
    const decoder = new FrameDecoder((message) => messages.push(message));

    decoder.push(frame.subarray(0, 2));
    decoder.push(frame.subarray(2, 7));
    decoder.push(frame.subarray(7));

    assert.deepEqual(messages, [{ type: "broadcast", method: "hello" }]);
  });

  it("decodes multiple frames in a single chunk", () => {
    const first = encodeMessage({ type: "response", requestId: "a", resultType: "success" });
    const second = encodeMessage({ type: "response", requestId: "b", resultType: "success" });
    const messages: CodexIpcMessage[] = [];
    const decoder = new FrameDecoder((message) => messages.push(message));

    decoder.push(Buffer.concat([first, second]));

    assert.deepEqual(messages, [
      { type: "response", requestId: "a", resultType: "success" },
      { type: "response", requestId: "b", resultType: "success" },
    ]);
  });

  it("rejects zero-length frames", () => {
    const messages: CodexIpcMessage[] = [];
    const decoder = new FrameDecoder((message) => messages.push(message));
    const frame = Buffer.alloc(4);

    assert.throws(() => decoder.push(frame), /Invalid frame length/);
    assert.deepEqual(messages, []);
  });
});

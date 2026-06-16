const MAX_FRAME_BYTES = 256 * 1024 * 1024;

import type { CodexIpcMessage } from "./types.ts";

export function encodeMessage(message: CodexIpcMessage): Buffer {
  const payload = JSON.stringify(message);
  const byteLength = Buffer.byteLength(payload, "utf8");
  const frame = Buffer.allocUnsafe(4 + byteLength);

  frame.writeUInt32LE(byteLength, 0);
  frame.write(payload, 4, "utf8");

  return frame;
}

export class FrameDecoder {
  #header = Buffer.allocUnsafe(4);
  #headerOffset = 0;
  #body: Buffer | null = null;
  #bodyOffset = 0;
  #onMessage: (message: CodexIpcMessage) => void;

  constructor(onMessage: (message: CodexIpcMessage) => void) {
    this.#onMessage = onMessage;
  }

  push(chunk: Buffer): void {
    let offset = 0;

    while (offset < chunk.length) {
      if (this.#body === null) {
        const copied = chunk.copy(
          this.#header,
          this.#headerOffset,
          offset,
          offset + Math.min(4 - this.#headerOffset, chunk.length - offset),
        );
        this.#headerOffset += copied;
        offset += copied;

        if (this.#headerOffset < 4) {
          return;
        }

        const frameLength = this.#header.readUInt32LE(0);
        this.#headerOffset = 0;

        if (frameLength === 0 || frameLength > MAX_FRAME_BYTES) {
          throw new Error(`Invalid frame length (${frameLength} bytes)`);
        }

        this.#body = Buffer.allocUnsafe(frameLength);
        this.#bodyOffset = 0;
      }

      const body = this.#body;
      const copied = chunk.copy(
        body,
        this.#bodyOffset,
        offset,
        offset + Math.min(body.length - this.#bodyOffset, chunk.length - offset),
      );
      this.#bodyOffset += copied;
      offset += copied;

      if (this.#bodyOffset < body.length) {
        return;
      }

      const message = JSON.parse(body.toString("utf8")) as CodexIpcMessage;
      this.#body = null;
      this.#bodyOffset = 0;
      this.#onMessage(message);
    }
  }
}

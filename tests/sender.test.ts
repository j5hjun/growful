import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { OutboxCodexThreadSender, UnavailableCodexThreadSender } from "../src/sender/codexThreadSender.js";

describe("Codex thread senders", () => {
  it("unavailable sender fails clearly", async () => {
    const sender = new UnavailableCodexThreadSender("No Codex thread-send command is configured.");

    await expect(sender.sendMessage({ threadId: "thread-1", message: "hello" })).rejects.toThrow(
      "No Codex thread-send command is configured.",
    );
  });

  it("outbox sender writes a due message for inspection", async () => {
    const dir = join(tmpdir(), `reminder-mcp-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      const sender = new OutboxCodexThreadSender(dir);

      await sender.sendMessage({ threadId: "thread-1", message: "hello" });

      const files = await import("node:fs/promises").then((fs) => fs.readdir(dir));
      expect(files).toHaveLength(1);
      const body = JSON.parse(await readFile(join(dir, files[0]), "utf8"));
      expect(body.threadId).toBe("thread-1");
      expect(body.message).toBe("hello");
      expect(body.incompleteFallback).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

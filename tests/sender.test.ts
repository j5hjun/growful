import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  CommandCodexThreadSender,
  OutboxCodexThreadSender,
  UnavailableCodexThreadSender,
} from "../src/sender/codexThreadSender.js";

describe("Codex thread senders", () => {
  it("unavailable sender fails clearly", async () => {
    const sender = new UnavailableCodexThreadSender("No Codex thread-send command is configured.");

    await expect(sender.sendMessage({ threadId: "thread-1", message: "hello" })).rejects.toThrow(
      "No Codex thread-send command is configured.",
    );
  });

  it("outbox sender writes a due message for inspection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reminder-mcp-"));
    try {
      const sender = new OutboxCodexThreadSender(dir);

      await sender.sendMessage({ threadId: "thread-1", message: "hello" });

      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      const body = JSON.parse(await readFile(join(dir, files[0]), "utf8"));
      expect(body.threadId).toBe("thread-1");
      expect(body.message).toBe("hello");
      expect(body.incompleteFallback).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("command sender sends JSON stdin and thread id env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reminder-mcp-"));
    try {
      const outputPath = join(dir, "command-output.json");
      const sender = new CommandCodexThreadSender(process.execPath, [
        "-e",
        `
          const { writeFileSync } = require("node:fs");
          let stdin = "";
          process.stdin.setEncoding("utf8");
          process.stdin.on("data", (chunk) => { stdin += chunk; });
          process.stdin.on("end", () => {
            writeFileSync(process.argv[1], JSON.stringify({
              stdin,
              threadId: process.env.CODEX_THREAD_ID
            }));
          });
        `,
        outputPath,
      ]);

      await sender.sendMessage({ threadId: "thread-1", message: "hello" });

      const body = JSON.parse(await readFile(outputPath, "utf8"));
      expect(JSON.parse(body.stdin)).toEqual({ threadId: "thread-1", message: "hello" });
      expect(body.threadId).toBe("thread-1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("command sender rejects non-zero exits with stderr", async () => {
    const sender = new CommandCodexThreadSender(process.execPath, [
      "-e",
      `
        process.stderr.write("delivery failed\\n");
        process.exit(42);
      `,
    ]);

    await expect(sender.sendMessage({ threadId: "thread-1", message: "hello" })).rejects.toThrow(
      "Codex thread-send command exited with code 42: delivery failed",
    );
  });
});

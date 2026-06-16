import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CodexThreadSender } from "../types.js";

type SendMessageInput = Parameters<CodexThreadSender["sendMessage"]>[0];

export class UnavailableCodexThreadSender implements CodexThreadSender {
  constructor(private readonly reason: string) {}

  async sendMessage(_input: SendMessageInput): Promise<void> {
    throw new Error(this.reason);
  }
}

export class OutboxCodexThreadSender implements CodexThreadSender {
  constructor(private readonly outboxDir: string) {}

  async sendMessage(input: SendMessageInput): Promise<void> {
    await mkdir(this.outboxDir, { recursive: true });

    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    const body = {
      threadId: input.threadId,
      message: input.message,
      incompleteFallback: true,
      createdAt: new Date().toISOString(),
    };

    await writeFile(join(this.outboxDir, fileName), `${JSON.stringify(body, null, 2)}\n`, "utf8");
  }
}

export class CommandCodexThreadSender implements CodexThreadSender {
  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
  ) {}

  async sendMessage(input: SendMessageInput): Promise<void> {
    const payload = JSON.stringify(input);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.command, this.args, {
        env: {
          ...process.env,
          CODEX_THREAD_ID: input.threadId,
        },
        stdio: ["pipe", "ignore", "pipe"],
      });

      let stderr = "";

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", reject);

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`Codex thread-send command exited with code ${code}${suffix}`));
      });

      child.stdin.end(`${payload}\n`);
    });
  }
}

#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runMcpServer } from "./mcpServer.js";
import { processDueReminders, startScheduler } from "./scheduler.js";
import {
  CommandCodexThreadSender,
  OutboxCodexThreadSender,
  UnavailableCodexThreadSender,
} from "./sender/codexThreadSender.js";
import { createShutdown } from "./shutdown.js";
import { SqliteReminderStore } from "./store/sqliteReminderStore.js";
import type { CodexThreadSender } from "./types.js";

const config = loadConfig();
const store = new SqliteReminderStore(config.dbPath);
const sender = createSender();
const scheduler = startScheduler({
  store,
  sender,
  onError(error) {
    console.error("Reminder scheduler failed:", error);
  },
});

const shutdown = createShutdown({
  scheduler,
  close: () => store.close(),
  onSignal: (signal) => process.kill(process.pid, signal),
});

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.stdin.once("close", () => shutdown());
process.stdin.once("end", () => shutdown());

await runMcpServer({
  store,
  defaultThreadId: config.threadId,
  processDue: (now) => processDueReminders({ store, sender, now }),
  onClose: () => shutdown(),
});

function createSender(): CodexThreadSender {
  if (config.sendCommand) {
    return new CommandCodexThreadSender(config.sendCommand);
  }

  if (config.allowOutboxFallback) {
    return new OutboxCodexThreadSender(config.outboxDir);
  }

  return new UnavailableCodexThreadSender(
    "Codex reminder delivery is not configured. Set REMINDER_MCP_SEND_COMMAND to a command that sends JSON stdin to a Codex thread, or set REMINDER_MCP_ALLOW_OUTBOX_FALLBACK=1 for local outbox files.",
  );
}

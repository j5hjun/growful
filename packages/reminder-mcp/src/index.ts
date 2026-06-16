#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runMcpServer } from "./mcpServer.js";
import { processDueReminders, startScheduler } from "./scheduler.js";
import {
  CodexIpcThreadSender,
  CommandCodexThreadSender,
  OutboxCodexThreadSender,
  UnavailableCodexThreadSender,
} from "./sender/codexThreadSender.js";
import { createShutdown } from "./shutdown.js";
import { SqliteReminderStore } from "./store/sqliteReminderStore.js";
import type { CodexThreadSender } from "./types.js";

const config = loadConfig();
const store = new SqliteReminderStore(config.dbPath);
const recoveredSendingCount = store.markSendingRemindersFailed(
  "Reminder delivery was interrupted while marked sending; delivery status is unknown.",
);
if (recoveredSendingCount > 0) {
  console.warn(`Recovered ${recoveredSendingCount} interrupted reminder send(s) as failed.`);
}
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
  onSignal: (signal) => {
    process.exitCode = getSignalExitCode(signal);
    process.exit();
  },
});

process.once("SIGINT", (signal) => void shutdown(signal));
process.once("SIGTERM", (signal) => void shutdown(signal));
process.stdin.once("close", () => void shutdown());
process.stdin.once("end", () => void shutdown());

await runMcpServer({
  store,
  defaultThreadId: config.threadId,
  processDue: (now) => processDueReminders({ store, sender, now }),
  onClose: () => void shutdown(),
});

function createSender(): CodexThreadSender {
  if (config.useCodexIpc) {
    return new CodexIpcThreadSender({
      socketPath: config.codexIpcSocketPath,
      cwd: config.codexIpcCwd,
      timeoutMs: config.codexIpcTimeoutMs,
    });
  }

  if (config.sendCommand) {
    return new CommandCodexThreadSender(config.sendCommand);
  }

  if (config.allowOutboxFallback) {
    return new OutboxCodexThreadSender(config.outboxDir);
  }

  return new UnavailableCodexThreadSender(
    "Codex reminder delivery is not configured. Set REMINDER_MCP_USE_CODEX_IPC=1 for local IPC delivery, REMINDER_MCP_SEND_COMMAND for an external delivery command, or REMINDER_MCP_ALLOW_OUTBOX_FALLBACK=1 for local outbox files.",
  );
}

function getSignalExitCode(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 143;
}

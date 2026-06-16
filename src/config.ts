import { homedir } from "node:os";
import { join } from "node:path";

export interface ReminderMcpConfig {
  dbPath: string;
  threadId: string | undefined;
  sendCommand: string | undefined;
  allowOutboxFallback: boolean;
  outboxDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ReminderMcpConfig {
  const dataDir = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  const appDir = join(dataDir, "reminder-mcp");

  return {
    dbPath: env.REMINDER_MCP_DB_PATH ?? join(appDir, "reminders.sqlite"),
    threadId: env.CODEX_THREAD_ID,
    sendCommand: env.REMINDER_MCP_SEND_COMMAND,
    allowOutboxFallback: env.REMINDER_MCP_ALLOW_OUTBOX_FALLBACK === "1",
    outboxDir: env.REMINDER_MCP_OUTBOX_DIR ?? join(appDir, "outbox"),
  };
}

import { homedir } from "node:os";
import { join } from "node:path";

export interface ReminderMcpConfig {
  dbPath: string;
  threadId: string | undefined;
  sendCommand: string | undefined;
  useCodexIpc: boolean;
  codexIpcSocketPath: string | undefined;
  codexIpcCwd: string | undefined;
  codexIpcTimeoutMs: number | undefined;
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
    useCodexIpc: env.REMINDER_MCP_USE_CODEX_IPC === "1",
    codexIpcSocketPath: env.REMINDER_MCP_CODEX_IPC_SOCKET,
    codexIpcCwd: env.REMINDER_MCP_CODEX_IPC_CWD,
    codexIpcTimeoutMs: parseOptionalInteger(env.REMINDER_MCP_CODEX_IPC_TIMEOUT_MS),
    allowOutboxFallback: env.REMINDER_MCP_ALLOW_OUTBOX_FALLBACK === "1",
    outboxDir: env.REMINDER_MCP_OUTBOX_DIR ?? join(appDir, "outbox"),
  };
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer environment value, received: ${value}`);
  }
  return parsed;
}

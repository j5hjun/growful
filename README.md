# Reminder MCP

Local MCP server for scheduling reminder messages to a Codex thread.

## Setup

Install dependencies, run the tests, and build the server:

```bash
npm install
npm test
npm run build
```

During development, run the MCP server directly from TypeScript:

```bash
npm run dev
```

After building, the package exposes a `reminder-mcp` binary at `./dist/index.js`.

## Environment

| Variable | Description |
| --- | --- |
| `CODEX_THREAD_ID` | Default Codex thread used when a tool call omits `threadId`. |
| `REMINDER_MCP_DB_PATH` | SQLite database path. Defaults to `$XDG_DATA_HOME/reminder-mcp/reminders.sqlite` or `~/.local/share/reminder-mcp/reminders.sqlite`. |
| `REMINDER_MCP_USE_CODEX_IPC` | Set to `1` to send due reminders through Codex's local `codex-ipc` socket. This uses the internal thread-follower start-turn path for idle threads. |
| `REMINDER_MCP_CODEX_IPC_SOCKET` | Optional explicit Codex IPC socket path. Defaults to `$TMPDIR/codex-ipc/ipc-<uid>.sock`. |
| `REMINDER_MCP_CODEX_IPC_CWD` | Optional working directory for IPC start-turn payloads. Defaults to the MCP server process cwd. |
| `REMINDER_MCP_CODEX_IPC_TIMEOUT_MS` | Optional positive integer request timeout for IPC calls. Defaults to `30000`. |
| `REMINDER_MCP_SEND_COMMAND` | Command used for real delivery. The command receives `{"threadId","message"}` as JSON on stdin and also gets `CODEX_THREAD_ID` in its environment. |
| `REMINDER_MCP_ALLOW_OUTBOX_FALLBACK` | Set to `1` to write due reminders to outbox files when no send command is configured. |
| `REMINDER_MCP_OUTBOX_DIR` | Outbox directory. Defaults to `$XDG_DATA_HOME/reminder-mcp/outbox` or `~/.local/share/reminder-mcp/outbox`. |

If neither `REMINDER_MCP_USE_CODEX_IPC=1`, `REMINDER_MCP_SEND_COMMAND`, nor `REMINDER_MCP_ALLOW_OUTBOX_FALLBACK=1` is set, reminders can be created and listed, but due reminder delivery fails with a setup message.

## MCP Client Config

Build the project first:

```bash
npm run build
```

Then configure an MCP client to launch the built server over stdio:

```json
{
  "mcpServers": {
    "reminder-mcp": {
      "command": "node",
      "args": ["/Users/johjun/Documents/growful/dist/index.js"],
      "env": {
        "CODEX_THREAD_ID": "your-codex-thread-id",
        "REMINDER_MCP_USE_CODEX_IPC": "1",
        "REMINDER_MCP_CODEX_IPC_CWD": "/Users/johjun/Documents/growful"
      }
    }
  }
}
```

The IPC sender uses Codex's local internal `codex-ipc` socket. It initializes as a non-owner follower client, replies to discovery requests with `canHandle: false`, and sends `thread-follower-start-turn` for the target `CODEX_THREAD_ID`. This currently supports idle-thread start-turn delivery only; active-turn steering is not implemented. This path is internal and may change between Codex versions.

If you prefer an external delivery bridge instead of IPC, configure `REMINDER_MCP_SEND_COMMAND`:

```json
{
  "mcpServers": {
    "reminder-mcp": {
      "command": "node",
      "args": ["/Users/johjun/Documents/growful/dist/index.js"],
      "env": {
        "CODEX_THREAD_ID": "your-codex-thread-id",
        "REMINDER_MCP_SEND_COMMAND": "/path/to/thread-send-command"
      }
    }
  }
}
```

For local development without real Codex thread delivery, use the explicit outbox fallback:

```json
{
  "mcpServers": {
    "reminder-mcp": {
      "command": "node",
      "args": ["/Users/johjun/Documents/growful/dist/index.js"],
      "env": {
        "CODEX_THREAD_ID": "your-codex-thread-id",
        "REMINDER_MCP_ALLOW_OUTBOX_FALLBACK": "1"
      }
    }
  }
}
```

The server registers these tools: `set_reminder`, `list_reminders`, `cancel_reminder`, and `send_due_reminders`.

## Codex Delivery Status

Real Codex thread delivery can use the local IPC sender by setting `REMINDER_MCP_USE_CODEX_IPC=1`. If IPC is unavailable or incompatible with the installed Codex version, the server can use an explicit outbox fallback for development, but that fallback is not real delivery.

On this machine, `codex --help` exposes session commands such as `resume` and `fork`, but no command that clearly sends a prompt to an existing Codex thread.

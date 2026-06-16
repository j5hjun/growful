# Reminder MCP

Local MCP server for scheduling reminder messages to a Codex thread.

## Codex Delivery Status

Real Codex thread delivery must be confirmed on this machine before the project is considered complete. If no local Codex thread-send mechanism is available, the server can use an explicit outbox fallback for development, but that fallback is not real delivery.

On this machine, `codex --help` exposes session commands such as `resume` and `fork`, but no command that clearly sends a prompt to an existing Codex thread.

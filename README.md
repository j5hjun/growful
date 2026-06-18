# Growful

Local Codex automation workspace.

## Packages

### Codex IPC Observer

This repository currently exposes a small TypeScript Node ESM observer for the
local Codex IPC router.

The first milestone is intentionally read-only:

- resolves the default `codex-ipc` socket path
- reads and writes Codex IPC length-prefixed JSON frames
- connects and sends `initialize`
- stores the returned `clientId`
- receives router broadcasts
- emits normalized `thread-stream-state-changed` events
- answers `client-discovery-request` with `canHandle: false` by default
- provides thin `thread-follower-start-turn` and `thread-follower-steer-turn` helpers

It does not claim ownership of threads beyond forwarding those request helpers.

```ts
import { CodexIpcClient } from "@growful/codex-ipc";

const client = new CodexIpcClient();

client.onThreadStateChanged((event) => {
  console.log(event.conversationId, event.changeType, event.revision);
});

await client.connect();
```

Known thread-follower helpers are also available:

```ts
await client.startTurn({
  conversationId: "conversation-1",
  turnStartParams: {
    input: [{ type: "text", text: "hello" }],
  },
});
```

Use `onBroadcast` if you need raw IPC broadcasts:

```ts
client.onBroadcast((message) => {
  console.log(message.method);
});
```

Broadcast payloads can contain thread contents. Do not log full payloads unless
you explicitly intend to capture sensitive local conversation state.

## Commands

Install dependencies from the repository root:

```sh
npm install
```

Run unit tests:

```sh
npm test
```

Build the TypeScript package:

```sh
npm run build
```

Run the opt-in integration test against the local Codex IPC socket:

```sh
npm run test:integration
```

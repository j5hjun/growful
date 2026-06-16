import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseDueAt } from "./time.js";
import type { NewReminderInput, Reminder, ReminderStatus } from "./types.js";

export interface ReminderHandlerStore {
  createReminder(input: NewReminderInput): Reminder;
  listReminders(input?: { status?: ReminderStatus; limit?: number }): Reminder[];
  cancelReminder(id: string): Reminder;
}

export interface CreateReminderHandlersInput {
  store: ReminderHandlerStore;
  defaultThreadId?: string;
  processDue: (now?: string) => unknown;
  now?: () => Date;
}

export interface ReminderHandlers {
  setReminder(args: { message: string; dueAt: string; threadId?: string }): Reminder;
  listReminders(args?: { status?: ReminderStatus; limit?: number }): { reminders: Reminder[] };
  cancelReminder(args: { id: string }): Reminder;
  sendDueReminders(args?: { now?: string }): unknown;
}

const statusSchema = z.enum(["pending", "sending", "sent", "cancelled", "failed"]);

export function createReminderHandlers(input: CreateReminderHandlersInput): ReminderHandlers {
  const defaultThreadId = trimOptional(input.defaultThreadId);
  const now = input.now ?? (() => new Date());

  return {
    setReminder(args) {
      const message = args.message.trim();
      if (!message) {
        throw new Error("Reminder message is required");
      }

      const threadId = trimOptional(args.threadId) ?? defaultThreadId;
      if (!threadId) {
        throw new Error("Missing target Codex thread. Pass threadId or set CODEX_THREAD_ID.");
      }

      const dueAt = parseDueAt(args.dueAt, now());
      return input.store.createReminder({ message, threadId, dueAt });
    },
    listReminders(args = {}) {
      return { reminders: input.store.listReminders({ status: args.status, limit: args.limit }) };
    },
    cancelReminder(args) {
      return input.store.cancelReminder(args.id);
    },
    sendDueReminders(args = {}) {
      return input.processDue(args.now);
    },
  };
}

export async function runMcpServer(input: CreateReminderHandlersInput): Promise<void> {
  const handlers = createReminderHandlers(input);
  const server = new McpServer({ name: "reminder-mcp", version: "0.1.0" });

  server.registerTool(
    "set_reminder",
    {
      title: "Set reminder",
      description: "Schedule a reminder message for a Codex thread.",
      inputSchema: {
        message: z.string(),
        dueAt: z.string(),
        threadId: z.string().optional(),
      },
    },
    (args) => jsonText(handlers.setReminder(args)),
  );

  server.registerTool(
    "list_reminders",
    {
      title: "List reminders",
      description: "List scheduled reminders.",
      inputSchema: {
        status: statusSchema.optional(),
        limit: z.number().int().positive().optional(),
      },
    },
    (args) => jsonText(handlers.listReminders(args)),
  );

  server.registerTool(
    "cancel_reminder",
    {
      title: "Cancel reminder",
      description: "Cancel a pending reminder.",
      inputSchema: {
        id: z.string(),
      },
    },
    (args) => jsonText(handlers.cancelReminder(args)),
  );

  server.registerTool(
    "send_due_reminders",
    {
      title: "Send due reminders",
      description: "Immediately process reminders due at or before now.",
      inputSchema: {
        now: z.string().optional(),
      },
    },
    async (args) => jsonText(await handlers.sendDueReminders(args)),
  );

  await server.connect(new StdioServerTransport());
}

function jsonText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

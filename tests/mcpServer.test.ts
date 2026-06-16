import { describe, expect, it, vi } from "vitest";
import { createReminderHandlers, type ReminderHandlerStore } from "../src/mcpServer.js";
import { createShutdown } from "../src/shutdown.js";
import type { Reminder } from "../src/types.js";

describe("createReminderHandlers", () => {
  it("creates reminders using configured defaultThreadId", () => {
    const store = createMemoryStore();
    const handlers = createReminderHandlers({
      store,
      defaultThreadId: " thread-default ",
      processDue: vi.fn(),
      now: () => new Date("2026-06-16T00:00:00.000Z"),
    });

    const reminder = handlers.setReminder({ message: "  water basil  ", dueAt: "30m" });

    expect(reminder).toMatchObject({
      message: "water basil",
      threadId: "thread-default",
      dueAt: "2026-06-16T00:30:00.000Z",
      status: "pending",
    });
    expect(store.reminders).toHaveLength(1);
  });

  it("requires target thread if neither threadId nor default configured", () => {
    const handlers = createReminderHandlers({
      store: createMemoryStore(),
      processDue: vi.fn(),
      now: () => new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(() => handlers.setReminder({ message: "hello", dueAt: "30m" })).toThrow(
      "Missing target Codex thread. Pass threadId or set CODEX_THREAD_ID.",
    );
  });

  it("lists and cancels reminders", () => {
    const store = createMemoryStore();
    const handlers = createReminderHandlers({
      store,
      defaultThreadId: "thread-1",
      processDue: vi.fn(),
      now: () => new Date("2026-06-16T00:00:00.000Z"),
    });
    const first = handlers.setReminder({ message: "first", dueAt: "30m" });
    handlers.setReminder({ message: "second", dueAt: "1h" });

    const listed = handlers.listReminders({ status: "pending", limit: 1 });
    const cancelled = handlers.cancelReminder({ id: first.id });

    expect(listed.reminders.map((item) => item.id)).toEqual([first.id]);
    expect(cancelled.status).toBe("cancelled");
    expect(handlers.listReminders().reminders.map((item) => item.status)).toEqual(["cancelled", "pending"]);
  });

  it.each(["zzzz", "June 16, 2026", "2026-02-30T00:00:00.000Z"])(
    "rejects invalid send_due_reminders now value %s before processing",
    async (now) => {
      const processDue = vi.fn();
      const handlers = createReminderHandlers({
        store: createMemoryStore(),
        processDue,
      });

      await expect(handlers.sendDueReminders({ now })).rejects.toThrow("Invalid now timestamp. Use a valid UTC ISO timestamp.");
      expect(processDue).not.toHaveBeenCalled();
    },
  );

  it("passes valid strict ISO now to processDue", async () => {
    const processDue = vi.fn().mockResolvedValue({ processed: 0, sent: 0, failed: 0, results: [] });
    const handlers = createReminderHandlers({
      store: createMemoryStore(),
      processDue,
    });

    await expect(handlers.sendDueReminders({ now: "2026-06-16T00:00:00.000Z" })).resolves.toEqual({
      processed: 0,
      sent: 0,
      failed: 0,
      results: [],
    });
    expect(processDue).toHaveBeenCalledWith("2026-06-16T00:00:00.000Z");
  });
});

describe("createShutdown", () => {
  it("clears the scheduler and closes the store once", () => {
    const timer = setInterval(() => undefined, 60_000);
    const close = vi.fn();
    const shutdown = createShutdown({ scheduler: timer, close });

    shutdown();
    shutdown();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

function createMemoryStore(): ReminderHandlerStore & { reminders: Reminder[] } {
  const reminders: Reminder[] = [];

  return {
    reminders,
    createReminder(input) {
      const now = "2026-06-16T00:00:00.000Z";
      const reminder: Reminder = {
        id: `reminder-${reminders.length + 1}`,
        message: input.message,
        threadId: input.threadId,
        dueAt: input.dueAt,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        sentAt: null,
        lastError: null,
        attemptCount: 0,
      };
      reminders.push(reminder);
      return reminder;
    },
    listReminders(input = {}) {
      const filtered = input.status ? reminders.filter((item) => item.status === input.status) : reminders;
      return filtered.slice(0, input.limit ?? filtered.length);
    },
    cancelReminder(id) {
      const reminder = reminders.find((item) => item.id === id);
      if (!reminder) {
        throw new Error(`Reminder not found: ${id}`);
      }
      reminder.status = "cancelled";
      return reminder;
    },
  };
}

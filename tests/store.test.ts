import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteReminderStore } from "../src/store/sqliteReminderStore.js";

describe("SqliteReminderStore", () => {
  let dir: string;
  let store: SqliteReminderStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reminder-store-"));
    store = new SqliteReminderStore(join(dir, "reminders.sqlite"));
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("creates and retrieves reminders", () => {
    const reminder = store.createReminder({
      message: "check build",
      threadId: "thread-1",
      dueAt: "2026-06-16T12:00:00.000Z",
    });

    expect(reminder.status).toBe("pending");
    expect(reminder.message).toBe("check build");
    expect(store.listReminders({ status: "pending" })).toHaveLength(1);
  });

  it("cancels only pending reminders", () => {
    const reminder = store.createReminder({
      message: "check build",
      threadId: "thread-1",
      dueAt: "2026-06-16T12:00:00.000Z",
    });

    const cancelled = store.cancelReminder(reminder.id);

    expect(cancelled.status).toBe("cancelled");
    expect(() => store.cancelReminder(reminder.id)).toThrow("Reminder is not pending");
  });

  it("claims due reminders as sending", () => {
    const due = store.createReminder({
      message: "due",
      threadId: "thread-1",
      dueAt: "2026-06-16T00:00:00.000Z",
    });
    store.createReminder({
      message: "future",
      threadId: "thread-1",
      dueAt: "2026-06-17T00:00:00.000Z",
    });

    const claimed = store.claimDueReminders("2026-06-16T00:00:00.000Z", 10);

    expect(claimed.map((item) => item.id)).toEqual([due.id]);
    expect(store.getReminder(due.id)?.status).toBe("sending");
    expect(store.claimDueReminders("2026-06-16T00:00:00.000Z", 10)).toHaveLength(0);
  });

  it("marks reminders sent and failed", () => {
    const reminder = store.createReminder({
      message: "due",
      threadId: "thread-1",
      dueAt: "2026-06-16T00:00:00.000Z",
    });
    store.claimDueReminders("2026-06-16T00:00:00.000Z", 10);

    const failed = store.markFailed(reminder.id, "boom");
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toBe("boom");
    expect(failed.attemptCount).toBe(1);
  });
});

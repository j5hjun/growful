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

  it("claims due reminders by due date up to the limit", () => {
    const secondDue = store.createReminder({
      message: "second due",
      threadId: "thread-1",
      dueAt: "2026-06-16T02:00:00.000Z",
    });
    const firstDue = store.createReminder({
      message: "first due",
      threadId: "thread-1",
      dueAt: "2026-06-16T01:00:00.000Z",
    });
    store.createReminder({
      message: "future",
      threadId: "thread-1",
      dueAt: "2026-06-17T00:00:00.000Z",
    });

    expect(store.claimDueReminders("2026-06-16T03:00:00.000Z", 1).map((item) => item.id)).toEqual([firstDue.id]);
    expect(store.claimDueReminders("2026-06-16T03:00:00.000Z", 1).map((item) => item.id)).toEqual([secondDue.id]);
    expect(store.claimDueReminders("2026-06-16T03:00:00.000Z", 1)).toHaveLength(0);
  });

  it("marks sending reminders sent", () => {
    const reminder = store.createReminder({
      message: "due",
      threadId: "thread-1",
      dueAt: "2026-06-16T00:00:00.000Z",
    });
    store.claimDueReminders("2026-06-16T00:00:00.000Z", 10);

    const sent = store.markSent(reminder.id);

    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toEqual(expect.any(String));
    expect(sent.lastError).toBeNull();
  });

  it("marks sending reminders failed", () => {
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

  it("marks persisted sending reminders failed without making them claimable again", () => {
    const dbPath = join(dir, "restart.sqlite");
    const restarted = new SqliteReminderStore(dbPath);
    const reminder = restarted.createReminder({
      message: "due",
      threadId: "thread-1",
      dueAt: "2026-06-16T00:00:00.000Z",
    });
    restarted.claimDueReminders("2026-06-16T00:00:00.000Z", 10);
    restarted.close();

    const recoveredStore = new SqliteReminderStore(dbPath);
    const recoveredCount = recoveredStore.markSendingRemindersFailed("delivery interrupted");
    const recovered = recoveredStore.getReminder(reminder.id);

    expect(recoveredCount).toBe(1);
    expect(recovered?.status).toBe("failed");
    expect(recovered?.lastError).toBe("delivery interrupted");
    expect(recovered?.attemptCount).toBe(1);
    expect(recoveredStore.claimDueReminders("2026-06-16T00:01:00.000Z", 10)).toHaveLength(0);
    recoveredStore.close();
  });

  it("rejects terminal transitions for pending reminders", () => {
    const reminder = store.createReminder({
      message: "pending",
      threadId: "thread-1",
      dueAt: "2026-06-16T00:00:00.000Z",
    });

    expect(() => store.markSent(reminder.id)).toThrow("Reminder is not sending");
    expect(() => store.markFailed(reminder.id, "boom")).toThrow("Reminder is not sending");
    expect(store.getReminder(reminder.id)?.status).toBe("pending");
  });

  it("throws clear errors for missing reminders", () => {
    expect(() => store.cancelReminder("missing")).toThrow("Reminder not found: missing");
    expect(() => store.markSent("missing")).toThrow("Reminder not found: missing");
    expect(() => store.markFailed("missing", "boom")).toThrow("Reminder not found: missing");
  });
});

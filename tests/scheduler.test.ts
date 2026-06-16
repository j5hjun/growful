import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processDueReminders, startScheduler, type ReminderStore } from "../src/scheduler.js";
import { SqliteReminderStore } from "../src/store/sqliteReminderStore.js";
import type { CodexThreadSender, Reminder } from "../src/types.js";

describe("scheduler", () => {
  let dir: string;
  let store: SqliteReminderStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reminder-scheduler-"));
    store = new SqliteReminderStore(join(dir, "reminders.sqlite"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("sends due reminders and marks them sent", async () => {
    const sent: Array<{ threadId: string; message: string }> = [];
    const sender: CodexThreadSender = {
      async sendMessage(input) {
        sent.push(input);
      },
    };
    store.createReminder({ message: "hello", threadId: "thread-1", dueAt: "2026-06-16T00:00:00.000Z" });

    const result = await processDueReminders({
      store,
      sender,
      now: "2026-06-16T00:00:00.000Z",
      limit: 10,
    });

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0, results: [{ id: expect.any(String), status: "sent" }] });
    expect(sent).toEqual([{ threadId: "thread-1", message: "hello" }]);
    expect(store.listReminders({ status: "sent" })).toHaveLength(1);
  });

  it("does not process failed reminders again automatically", async () => {
    const sender: CodexThreadSender = {
      async sendMessage() {
        throw new Error("send unavailable");
      },
    };
    const reminder = store.createReminder({ message: "hello", threadId: "thread-1", dueAt: "2026-06-16T00:00:00.000Z" });

    const result = await processDueReminders({
      store,
      sender,
      now: "2026-06-16T00:00:00.000Z",
      limit: 10,
    });

    expect(result.failed).toBe(1);
    const failed = store.getReminder(reminder.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.lastError).toBe("send unavailable");
    expect(store.claimDueReminders("2026-06-16T00:01:00.000Z", 10)).toHaveLength(0);
  });

  it("surfaces markSent errors without marking delivered reminders failed", async () => {
    const reminder = createClaimedReminder();
    let markFailedCalls = 0;
    const fakeStore: ReminderStore = {
      claimDueReminders() {
        return [reminder];
      },
      markSent() {
        throw new Error("mark sent unavailable");
      },
      markFailed() {
        markFailedCalls += 1;
        return { ...reminder, status: "failed" };
      },
    };
    const sender: CodexThreadSender = {
      async sendMessage() {},
    };

    await expect(processDueReminders({ store: fakeStore, sender })).rejects.toThrow("mark sent unavailable");
    expect(markFailedCalls).toBe(0);
  });

  it("preserves send failure context when markFailed also fails", async () => {
    const reminder = createClaimedReminder();
    const fakeStore: ReminderStore = {
      claimDueReminders() {
        return [reminder];
      },
      markSent() {
        return { ...reminder, status: "sent" };
      },
      markFailed() {
        throw new Error("mark failed unavailable");
      },
    };
    const sender: CodexThreadSender = {
      async sendMessage() {
        throw new Error("send unavailable");
      },
    };

    await expect(processDueReminders({ store: fakeStore, sender })).rejects.toThrow(
      /send unavailable.*mark failed unavailable/s,
    );
  });

  it("starts with an immediate tick and routes tick errors to onError", async () => {
    vi.useFakeTimers();
    const error = new Error("claim unavailable");
    const errors: unknown[] = [];
    const fakeStore: ReminderStore = {
      claimDueReminders() {
        throw error;
      },
      markSent() {
        throw new Error("unexpected markSent");
      },
      markFailed() {
        throw new Error("unexpected markFailed");
      },
    };
    const sender: CodexThreadSender = {
      async sendMessage() {},
    };

    const scheduler = startScheduler({
      store: fakeStore,
      sender,
      intervalMs: 1_000,
      onError: (caught) => errors.push(caught),
    });
    await flushPromises();
    await scheduler.stop();

    expect(errors).toEqual([error]);
  });

  it("does not start an overlapping tick while the previous tick is still running", async () => {
    vi.useFakeTimers();
    const reminder = createClaimedReminder();
    let claimCalls = 0;
    let resolveSend: () => void;
    const sendPromise = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const fakeStore: ReminderStore = {
      claimDueReminders() {
        claimCalls += 1;
        return [reminder];
      },
      markSent() {
        return { ...reminder, status: "sent" };
      },
      markFailed() {
        throw new Error("unexpected markFailed");
      },
    };
    const sender: CodexThreadSender = {
      sendMessage: vi.fn(() => sendPromise),
    };

    const scheduler = startScheduler({ store: fakeStore, sender, intervalMs: 1_000 });
    await flushPromises();
    expect(claimCalls).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(claimCalls).toBe(1);

    resolveSend!();
    await flushPromises();
    await scheduler.stop();
  });

  it("waits for an in-flight tick before stop resolves", async () => {
    vi.useFakeTimers();
    const reminder = createClaimedReminder();
    let isSending = false;
    let markSentCalls = 0;
    let resolveSend: () => void;
    const sendPromise = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const fakeStore: ReminderStore = {
      claimDueReminders() {
        return [reminder];
      },
      markSent() {
        markSentCalls += 1;
        return { ...reminder, status: "sent" };
      },
      markFailed() {
        throw new Error("unexpected markFailed");
      },
    };
    const sender: CodexThreadSender = {
      async sendMessage() {
        isSending = true;
        await sendPromise;
      },
    };

    const scheduler = startScheduler({ store: fakeStore, sender, intervalMs: 1_000 });
    await flushPromises();
    expect(isSending).toBe(true);

    let stopped = false;
    const stopPromise = scheduler.stop().then(() => {
      stopped = true;
    });
    await flushPromises();
    expect(stopped).toBe(false);

    resolveSend!();
    await stopPromise;

    expect(stopped).toBe(true);
    expect(markSentCalls).toBe(1);
  });
});

function createClaimedReminder(): Reminder {
  return {
    id: "reminder-1",
    message: "hello",
    threadId: "thread-1",
    dueAt: "2026-06-16T00:00:00.000Z",
    status: "sending",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    sentAt: null,
    lastError: null,
    attemptCount: 0,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

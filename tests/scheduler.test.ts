import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processDueReminders } from "../src/scheduler.js";
import { SqliteReminderStore } from "../src/store/sqliteReminderStore.js";
import type { CodexThreadSender } from "../src/types.js";

describe("scheduler", () => {
  let dir: string;
  let store: SqliteReminderStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reminder-scheduler-"));
    store = new SqliteReminderStore(join(dir, "reminders.sqlite"));
  });

  afterEach(async () => {
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
});

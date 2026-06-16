import type { SqliteReminderStore } from "./store/sqliteReminderStore.js";
import type { CodexThreadSender } from "./types.js";

export interface ProcessDueRemindersInput {
  store: SqliteReminderStore;
  sender: CodexThreadSender;
  now?: string;
  limit?: number;
}

export interface ProcessDueRemindersResult {
  processed: number;
  sent: number;
  failed: number;
  results: Array<{ id: string; status: "sent" | "failed" }>;
}

export async function processDueReminders(input: ProcessDueRemindersInput): Promise<ProcessDueRemindersResult> {
  const now = input.now ?? new Date().toISOString();
  const claimed = input.store.claimDueReminders(now, input.limit ?? 25);
  const results: ProcessDueRemindersResult["results"] = [];
  let sent = 0;
  let failed = 0;

  for (const reminder of claimed) {
    try {
      await input.sender.sendMessage({ threadId: reminder.threadId, message: reminder.message });
      const updated = input.store.markSent(reminder.id);
      results.push({ id: updated.id, status: "sent" });
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = input.store.markFailed(reminder.id, message);
      results.push({ id: updated.id, status: "failed" });
      failed += 1;
    }
  }

  return { processed: claimed.length, sent, failed, results };
}

export function startScheduler(input: {
  store: SqliteReminderStore;
  sender: CodexThreadSender;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): NodeJS.Timeout {
  const intervalMs = input.intervalMs ?? 15_000;
  const tick = async (): Promise<void> => {
    try {
      await processDueReminders({ store: input.store, sender: input.sender });
    } catch (error) {
      input.onError?.(error);
    }
  };

  void tick();
  return setInterval(() => void tick(), intervalMs);
}

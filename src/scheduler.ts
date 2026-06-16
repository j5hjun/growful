import type { SqliteReminderStore } from "./store/sqliteReminderStore.js";
import type { CodexThreadSender } from "./types.js";

export type ReminderStore = Pick<SqliteReminderStore, "claimDueReminders" | "markSent" | "markFailed">;

export interface ProcessDueRemindersInput {
  store: ReminderStore;
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
    } catch (error) {
      const message = getErrorMessage(error);
      let updated: ReturnType<ReminderStore["markFailed"]>;
      try {
        updated = input.store.markFailed(reminder.id, message);
      } catch (markFailedError) {
        throw new Error(
          `Failed to mark reminder ${reminder.id} failed after send failure. Send error: ${message}; markFailed error: ${getErrorMessage(markFailedError)}`,
          { cause: { sendError: error, markFailedError } },
        );
      }
      results.push({ id: updated.id, status: "failed" });
      failed += 1;
      continue;
    }

    const updated = input.store.markSent(reminder.id);
    results.push({ id: updated.id, status: "sent" });
    sent += 1;
  }

  return { processed: claimed.length, sent, failed, results };
}

export function startScheduler(input: {
  store: ReminderStore;
  sender: CodexThreadSender;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}): NodeJS.Timeout {
  const intervalMs = input.intervalMs ?? 15_000;
  let isRunning = false;
  const tick = async (): Promise<void> => {
    if (isRunning) {
      return;
    }

    isRunning = true;
    try {
      await processDueReminders({ store: input.store, sender: input.sender });
    } catch (error) {
      input.onError?.(error);
    } finally {
      isRunning = false;
    }
  };

  void tick();
  return setInterval(() => void tick(), intervalMs);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

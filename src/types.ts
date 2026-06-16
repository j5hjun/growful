export type ReminderStatus = "pending" | "sending" | "sent" | "cancelled" | "failed";

export interface Reminder {
  id: string;
  message: string;
  threadId: string;
  dueAt: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  lastError: string | null;
  attemptCount: number;
}

export interface NewReminderInput {
  message: string;
  threadId: string;
  dueAt: string;
}

export interface CodexThreadSender {
  sendMessage(input: { threadId: string; message: string }): Promise<void>;
}

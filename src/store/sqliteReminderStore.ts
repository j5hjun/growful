import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { NewReminderInput, Reminder, ReminderStatus } from "../types.js";

interface ReminderRow {
  id: string;
  message: string;
  thread_id: string;
  due_at: string;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  last_error: string | null;
  attempt_count: number;
}

export class SqliteReminderStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.bootstrap();
  }

  close(): void {
    this.db.close();
  }

  createReminder(input: NewReminderInput): Reminder {
    const now = new Date().toISOString();
    const reminder: Reminder = {
      id: randomUUID(),
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

    this.db
      .prepare(
        `INSERT INTO reminders
          (id, message, thread_id, due_at, status, created_at, updated_at, sent_at, last_error, attempt_count)
         VALUES
          (@id, @message, @threadId, @dueAt, @status, @createdAt, @updatedAt, @sentAt, @lastError, @attemptCount)`,
      )
      .run(reminder);

    return reminder;
  }

  getReminder(id: string): Reminder | null {
    const row = this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as ReminderRow | undefined;
    return row ? mapRow(row) : null;
  }

  listReminders(input: { status?: ReminderStatus; limit?: number } = {}): Reminder[] {
    const limit = input.limit ?? 100;
    const rows = input.status
      ? this.db.prepare("SELECT * FROM reminders WHERE status = ? ORDER BY due_at ASC LIMIT ?").all(input.status, limit)
      : this.db.prepare("SELECT * FROM reminders ORDER BY due_at ASC LIMIT ?").all(limit);

    return (rows as ReminderRow[]).map(mapRow);
  }

  cancelReminder(id: string): Reminder {
    const existing = this.getReminder(id);
    if (!existing) {
      throw new Error(`Reminder not found: ${id}`);
    }
    if (existing.status !== "pending") {
      throw new Error("Reminder is not pending");
    }

    const now = new Date().toISOString();
    this.db.prepare("UPDATE reminders SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, id);
    return this.getRequiredReminder(id);
  }

  claimDueReminders(now: string, limit: number): Reminder[] {
    const claim = this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at ASC LIMIT ?")
        .all(now, limit) as ReminderRow[];
      const updatedAt = new Date().toISOString();
      const update = this.db.prepare(
        "UPDATE reminders SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'",
      );

      for (const row of rows) {
        update.run(updatedAt, row.id);
      }

      return rows.map((row) => ({ ...mapRow(row), status: "sending" as const, updatedAt }));
    });

    return claim();
  }

  markSent(id: string): Reminder {
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE reminders SET status = 'sent', sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ?")
      .run(now, now, id);

    return this.getRequiredReminder(id);
  }

  markFailed(id: string, error: string): Reminder {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE reminders SET status = 'failed', last_error = ?, attempt_count = attempt_count + 1, updated_at = ? WHERE id = ?",
      )
      .run(error, now, id);

    return this.getRequiredReminder(id);
  }

  private getRequiredReminder(id: string): Reminder {
    const reminder = this.getReminder(id);
    if (!reminder) {
      throw new Error(`Reminder not found: ${id}`);
    }

    return reminder;
  }

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        message TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        due_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'cancelled', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT,
        last_error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_reminders_status_due_at ON reminders (status, due_at);
      CREATE INDEX IF NOT EXISTS idx_reminders_thread_id ON reminders (thread_id);
    `);
  }
}

function mapRow(row: ReminderRow): Reminder {
  return {
    id: row.id,
    message: row.message,
    threadId: row.thread_id,
    dueAt: row.due_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    lastError: row.last_error,
    attemptCount: row.attempt_count,
  };
}

const durationUnits: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
  minute: 60_000,
  minutes: 60_000,
  hour: 60 * 60_000,
  hours: 60 * 60_000,
  day: 24 * 60 * 60_000,
  days: 24 * 60 * 60_000,
  "분": 60_000,
  "시간": 60 * 60_000,
  "일": 24 * 60 * 60_000,
};

export function parseDueAt(input: string, now = new Date()): string {
  const trimmed = input.trim();
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  const compact = /^(\d+)([mhd])$/.exec(trimmed);
  if (compact) {
    return addDuration(now, Number(compact[1]), compact[2]);
  }

  const english = /^in\s+(\d+)\s+(minutes?|hours?|days?)$/i.exec(trimmed);
  if (english) {
    return addDuration(now, Number(english[1]), english[2].toLowerCase());
  }

  const korean = /^(\d+)\s*(분|시간|일)\s*뒤$/.exec(trimmed);
  if (korean) {
    return addDuration(now, Number(korean[1]), korean[2]);
  }

  throw new Error(
    "Unsupported dueAt format. Use an ISO timestamp, 30m, 2h, 1d, in 30 minutes, 30분 뒤, 2시간 뒤, or 1일 뒤.",
  );
}

function addDuration(now: Date, amount: number, unit: string): string {
  const ms = durationUnits[unit];
  if (!ms) {
    throw new Error(`Unsupported duration unit: ${unit}`);
  }
  return new Date(now.getTime() + amount * ms).toISOString();
}

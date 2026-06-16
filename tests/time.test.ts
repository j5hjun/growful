import { describe, expect, it } from "vitest";
import { parseDueAt } from "../src/time.js";

describe("parseDueAt", () => {
  const base = new Date("2026-06-16T00:00:00.000Z");

  it("accepts ISO timestamps", () => {
    expect(parseDueAt("2026-06-16T12:00:00.000Z", base)).toBe("2026-06-16T12:00:00.000Z");
  });

  it("rejects invalid ISO timestamps", () => {
    expect(() => parseDueAt("2026-02-30T00:00:00.000Z", base)).toThrow("Unsupported dueAt format");
    expect(() => parseDueAt("2026-06-16T24:00:00.000Z", base)).toThrow("Unsupported dueAt format");
  });

  it("accepts compact relative durations", () => {
    expect(parseDueAt("30m", base)).toBe("2026-06-16T00:30:00.000Z");
    expect(parseDueAt("2h", base)).toBe("2026-06-16T02:00:00.000Z");
    expect(parseDueAt("1d", base)).toBe("2026-06-17T00:00:00.000Z");
  });

  it("accepts English relative durations", () => {
    expect(parseDueAt("in 1 minute", base)).toBe("2026-06-16T00:01:00.000Z");
    expect(parseDueAt("in 30 minutes", base)).toBe("2026-06-16T00:30:00.000Z");
    expect(parseDueAt("in 1 hour", base)).toBe("2026-06-16T01:00:00.000Z");
    expect(parseDueAt("in 2 hours", base)).toBe("2026-06-16T02:00:00.000Z");
    expect(parseDueAt("in 1 day", base)).toBe("2026-06-17T00:00:00.000Z");
    expect(parseDueAt("in 2 days", base)).toBe("2026-06-18T00:00:00.000Z");
  });

  it("rejects mismatched English relative duration grammar", () => {
    expect(() => parseDueAt("in 1 days", base)).toThrow("Unsupported dueAt format");
    expect(() => parseDueAt("in 2 day", base)).toThrow("Unsupported dueAt format");
  });

  it("accepts Korean relative durations", () => {
    expect(parseDueAt("30분 뒤", base)).toBe("2026-06-16T00:30:00.000Z");
    expect(parseDueAt("2시간 뒤", base)).toBe("2026-06-16T02:00:00.000Z");
    expect(parseDueAt("1일 뒤", base)).toBe("2026-06-17T00:00:00.000Z");
  });

  it("rejects unsupported expressions", () => {
    expect(() => parseDueAt("tomorrow morning", base)).toThrow("Unsupported dueAt format");
  });

  it("rejects non-ISO date strings", () => {
    expect(() => parseDueAt("June 16, 2026", base)).toThrow("Unsupported dueAt format");
    expect(() => parseDueAt("06/16/2026", base)).toThrow("Unsupported dueAt format");
  });
});

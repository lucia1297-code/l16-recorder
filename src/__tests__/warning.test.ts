import { describe, it, expect } from "vitest";
import {
  bumpWarningOnCarryOver,
  resetWarningCount,
  isRecentWarning,
  type WarningRecord,
} from "../core/warning";

function rec(over: Partial<WarningRecord> = {}): WarningRecord {
  return {
    studentCode: "S1001",
    typeId: "t1",
    count: 0,
    lastWarnedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("bumpWarningOnCarryOver", () => {
  it("creates a new record at count 1 when the student had no prior warning record and is currently in warning status", () => {
    const now = new Date("2026-07-24T00:00:00.000Z");
    const result = bumpWarningOnCarryOver([], "S1001", "t1", "warning", now);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ studentCode: "S1001", typeId: "t1", count: 1 });
    expect(result[0].lastWarnedAt).toBe(now.toISOString());
  });

  it("increments an existing record's count by 1", () => {
    const now = new Date("2026-07-24T00:00:00.000Z");
    const existing = [rec({ count: 2 })];
    const result = bumpWarningOnCarryOver(existing, "S1001", "t1", "warning", now);
    expect(result.find((r) => r.studentCode === "S1001" && r.typeId === "t1")?.count).toBe(3);
  });

  it("does not change anything when status is not warning", () => {
    const now = new Date("2026-07-24T00:00:00.000Z");
    const existing = [rec({ count: 2, lastWarnedAt: "2026-01-01T00:00:00.000Z" })];
    const result = bumpWarningOnCarryOver(existing, "S1001", "t1", "good", now);
    expect(result).toEqual(existing);
  });

  it("leaves other students'/types' records untouched", () => {
    const now = new Date("2026-07-24T00:00:00.000Z");
    const existing = [rec({ studentCode: "S9999", typeId: "t9", count: 5 })];
    const result = bumpWarningOnCarryOver(existing, "S1001", "t1", "warning", now);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.studentCode === "S9999")?.count).toBe(5);
  });
});

describe("resetWarningCount", () => {
  it("sets the matching record's count to 0, keeping the record", () => {
    const existing = [rec({ count: 5 })];
    const result = resetWarningCount(existing, "S1001", "t1");
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(0);
  });

  it("does nothing if no matching record exists", () => {
    const existing = [rec({ studentCode: "S9999", count: 5 })];
    const result = resetWarningCount(existing, "S1001", "t1");
    expect(result).toEqual(existing);
  });

  it("only resets the matching student/type, not others", () => {
    const existing = [rec({ count: 5 }), rec({ studentCode: "S1002", count: 3 })];
    const result = resetWarningCount(existing, "S1001", "t1");
    expect(result.find((r) => r.studentCode === "S1001")?.count).toBe(0);
    expect(result.find((r) => r.studentCode === "S1002")?.count).toBe(3);
  });
});

describe("isRecentWarning", () => {
  it("returns true when warned within the last 3 days", () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    expect(isRecentWarning("2026-07-23T12:00:00.000Z", now)).toBe(true);
  });

  it("returns false when warned more than 3 days ago", () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    expect(isRecentWarning("2026-07-01T12:00:00.000Z", now)).toBe(false);
  });
});

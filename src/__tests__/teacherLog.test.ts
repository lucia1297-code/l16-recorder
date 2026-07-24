import { describe, it, expect } from "vitest";
import { createEmptyRows, getDayOfWeek, makeLogId, TEACHER_LOG_ROW_COUNT } from "../core/teacherLog";

describe("TEACHER_LOG_ROW_COUNT", () => {
  it("is 8, matching the teacher's existing sheet", () => {
    expect(TEACHER_LOG_ROW_COUNT).toBe(8);
  });
});

describe("createEmptyRows", () => {
  it("creates 8 rows numbered 1 through 8 with empty fields", () => {
    const rows = createEmptyRows();
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows[0]).toMatchObject({
      material: "",
      materialDetail: "",
      scope: "",
      completion: "",
      wrongNumbers: "",
    });
  });
});

describe("getDayOfWeek", () => {
  it("returns the correct Korean day of week for a given date", () => {
    // 2026-07-24 is a Friday
    expect(getDayOfWeek("2026-07-24")).toBe("금요일");
    // 2026-07-26 is a Sunday
    expect(getDayOfWeek("2026-07-26")).toBe("일요일");
  });
});

describe("makeLogId", () => {
  it("produces a stable, deterministic id from studentCode + date so re-saving updates instead of duplicating", () => {
    expect(makeLogId("S1001", "2026-07-24")).toBe(makeLogId("S1001", "2026-07-24"));
  });
  it("produces different ids for different students or dates", () => {
    expect(makeLogId("S1001", "2026-07-24")).not.toBe(makeLogId("S1002", "2026-07-24"));
    expect(makeLogId("S1001", "2026-07-24")).not.toBe(makeLogId("S1001", "2026-07-25"));
  });
});

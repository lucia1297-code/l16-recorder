import { describe, it, expect } from "vitest";
import { isPastDate, isPastExamDates, localTodayStr } from "../lib/examUtils";

describe("지난 시험 판별", () => {
  const today = "2026-11-14";
  it("오늘은 지난 것이 아니다", () => {
    expect(isPastDate("2026-11-14", today)).toBe(false);
    expect(isPastDate("2026-11-13", today)).toBe(true);
    expect(isPastDate("2026-12-10", today)).toBe(false);
  });
  it("날짜가 없으면 판단 불가 → 지난 것이 아님", () => {
    expect(isPastDate("", today)).toBe(false);
    expect(isPastDate(null, today)).toBe(false);
  });
  it("타임스탬프 형식도 처리", () => {
    expect(isPastDate("2026-10-08T00:00:00+00:00", today)).toBe(true);
  });
  it("영어 시험일 우선, 없으면 종료일, 시작일", () => {
    expect(isPastExamDates({ englishExamDate: "2026-09-30", examEnd: "2026-10-08" }, today)).toBe(true);
    expect(isPastExamDates({ englishExamDate: "2026-12-10", examEnd: "2026-10-08" }, today)).toBe(false);
    expect(isPastExamDates({ examEnd: "2026-10-08" }, today)).toBe(true);
    expect(isPastExamDates({ examStart: "2026-12-08" }, today)).toBe(false);
    expect(isPastExamDates({}, today)).toBe(false);
  });
  it("로컬 날짜 문자열", () => {
    expect(localTodayStr(new Date(2026, 10, 14, 0, 30))).toBe("2026-11-14");
  });
});

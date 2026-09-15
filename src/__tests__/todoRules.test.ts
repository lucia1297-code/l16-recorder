import { describe, it, expect } from "vitest";
import { computeTodos, formatDailyDigest, type TodoScheduleInput } from "../core/todoRules";
import type { RosterEntry } from "../core/roster";

function roster(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    studentCode: "S1", name: "정지민", school: "광영고", grade: "3",
    phone: "", teacher: "", note: "", ...overrides,
  };
}

function schedule(overrides: Partial<TodoScheduleInput> = {}): TodoScheduleInput {
  return {
    studentCode: "S1", subject: "영어",
    examStart: "", examEnd: "", englishExamDate: "",
    reportDeadline: "", nextLessonDate: "", ...overrides,
  };
}

const TODAY = new Date("2026-09-15T09:00:00");

describe("computeTodos", () => {
  it("수업자료 준비 — 다음 수업일이 내일이면 알림", () => {
    const items = computeTodos(
      [schedule({ nextLessonDate: "2026-09-16", subject: "독해" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "classPrep", studentCode: "S1", message: "정지민 '독해' 수업자료 준비가 1일 남았습니다." },
    ]);
  });

  it("수업자료 준비 — 이틀 남았으면 알림 없음 (경계값)", () => {
    const items = computeTodos(
      [schedule({ nextLessonDate: "2026-09-17" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("직보 예정 — 3일 남았으면 알림", () => {
    const items = computeTodos(
      [schedule({ reportDeadline: "2026-09-18" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "reportDeadline", studentCode: "S1", message: "정지민 직보 예정일이 3일 남았습니다." },
    ]);
  });

  it("영어시험 — 이틀 남았으면 알림", () => {
    const items = computeTodos(
      [schedule({ englishExamDate: "2026-09-17" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "englishExam", studentCode: "S1", message: "정지민 영어시험 이틀 전날입니다." },
    ]);
  });

  it("시험 시작일 — 오늘이면 학교명으로 알림", () => {
    const items = computeTodos(
      [schedule({ examStart: "2026-09-15" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
    ]);
  });

  it("시험 종료일 — 오늘이면 학교명으로 알림", () => {
    const items = computeTodos(
      [schedule({ examEnd: "2026-09-15" })],
      [roster()],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examEnd", message: "광영고 시험 종료일입니다." },
    ]);
  });

  it("같은 학교 여러 학생 시험 시작일 — 한 번만 알림", () => {
    const items = computeTodos(
      [
        schedule({ studentCode: "S1", examStart: "2026-09-15" }),
        schedule({ studentCode: "S2", examStart: "2026-09-15" }),
      ],
      [roster({ studentCode: "S1" }), roster({ studentCode: "S2", name: "박서연" })],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
    ]);
  });

  it("다른 학교면 시험 시작일 알림이 각각 나온다", () => {
    const items = computeTodos(
      [
        schedule({ studentCode: "S1", examStart: "2026-09-15" }),
        schedule({ studentCode: "S2", examStart: "2026-09-15" }),
      ],
      [roster({ studentCode: "S1" }), roster({ studentCode: "S2", name: "박서연", school: "다른고" })],
      TODAY,
    );
    expect(items).toEqual([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
      { type: "examStart", message: "다른고 시험 시작일입니다." },
    ]);
  });

  it("명부에 없는 studentCode는 건너뛴다", () => {
    const items = computeTodos(
      [schedule({ studentCode: "GHOST", examStart: "2026-09-15" })],
      [roster({ studentCode: "S1" })],
      TODAY,
    );
    expect(items).toEqual([]);
  });

  it("해당 없는 날은 빈 배열", () => {
    const items = computeTodos([schedule()], [roster()], TODAY);
    expect(items).toEqual([]);
  });
});

describe("formatDailyDigest", () => {
  it("메시지를 줄바꿈으로 이어붙인다", () => {
    const digest = formatDailyDigest([
      { type: "examStart", message: "광영고 시험 시작일입니다." },
      { type: "classPrep", studentCode: "S1", message: "정지민 '독해' 수업자료 준비가 1일 남았습니다." },
    ]);
    expect(digest).toBe("광영고 시험 시작일입니다.\n정지민 '독해' 수업자료 준비가 1일 남았습니다.");
  });

  it("빈 배열이면 빈 문자열", () => {
    expect(formatDailyDigest([])).toBe("");
  });
});

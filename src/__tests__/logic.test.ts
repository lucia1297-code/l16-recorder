import { describe, it, expect } from "vitest";
import {
  computeDashboard,
  toCSV,
  validateStudentInfo,
  validateExamInfo,
  validateReflection,
  percentScore,
} from "../core/logic";
import type { ExamResult } from "../core/types";

function makeResult(over: Partial<ExamResult> = {}): ExamResult {
  return {
    id: "r1",
    student: { studentCode: "S001", name: "홍길동", school: "창동고", grade: "3" },
    exam: {
      examName: "3월 학평",
      year: 2026,
      month: 3,
      round: 1,
      totalQuestions: 45,
      maxScore: 100,
    },
    teacher: "김민수",
    date: "2026-03-10",
    score: 80,
    wrongAnswers: [
      { questionNo: 21, reasons: ["Inference"] },
      { questionNo: 34, reasons: ["Vocabulary", "Time"] },
    ],
    reflection: { hardestReason: "빈칸", nextGoal: "1등급", satisfaction: 3 },
    submittedAt: "2026-03-10T10:00:00.000Z",
    ...over,
  };
}

describe("percentScore", () => {
  it("converts raw score to percentage of max", () => {
    expect(percentScore(80, 100)).toBe(80);
    expect(percentScore(45, 90)).toBe(50);
  });
  it("guards against zero max", () => {
    expect(percentScore(10, 0)).toBe(0);
  });
});

describe("validation", () => {
  it("requires all student fields", () => {
    expect(validateStudentInfo({ studentCode: "S1", name: "A", school: "B", grade: "3" }).length).toBe(0);
    expect(validateStudentInfo({ studentCode: "", name: "A", school: "B", grade: "3" }).length).toBeGreaterThan(0);
  });
  it("requires valid exam numbers", () => {
    const ok = validateExamInfo({ examName: "x", year: 2026, month: 3, round: 1, totalQuestions: 45, maxScore: 100 });
    expect(ok.length).toBe(0);
    const bad = validateExamInfo({ examName: "", year: 0, month: 0, round: 0, totalQuestions: 0, maxScore: 0 });
    expect(bad.length).toBeGreaterThan(0);
  });
  it("requires reflection text and satisfaction", () => {
    expect(validateReflection({ hardestReason: "a", nextGoal: "b", satisfaction: 3 }).length).toBe(0);
    expect(validateReflection({ hardestReason: "", nextGoal: "b", satisfaction: 3 }).length).toBeGreaterThan(0);
  });
});

describe("computeDashboard", () => {
  it("computes count/avg/max/min", () => {
    const rows = [
      makeResult({ id: "a", score: 80 }),
      makeResult({ id: "b", score: 60 }),
      makeResult({ id: "c", score: 100 }),
    ];
    const d = computeDashboard(rows);
    expect(d.studentCount).toBe(3);
    expect(d.avgScore).toBe(80);
    expect(d.maxScore).toBe(100);
    expect(d.minScore).toBe(60);
  });

  it("computes per-question wrong counts", () => {
    const rows = [
      makeResult({ id: "a", wrongAnswers: [{ questionNo: 21, reasons: [] }] }),
      makeResult({ id: "b", wrongAnswers: [{ questionNo: 21, reasons: [] }, { questionNo: 5, reasons: [] }] }),
    ];
    const d = computeDashboard(rows);
    const q21 = d.perQuestion.find((q) => q.questionNo === 21);
    expect(q21?.wrongCount).toBe(2);
  });

  it("computes per-school stats", () => {
    const rows = [
      makeResult({ id: "a", student: { studentCode: "1", name: "x", school: "창동고", grade: "3" }, score: 90 }),
      makeResult({ id: "b", student: { studentCode: "2", name: "y", school: "서초고", grade: "3" }, score: 70 }),
    ];
    const d = computeDashboard(rows);
    expect(d.perSchool.find((s) => s.school === "창동고")?.avgScore).toBe(90);
  });

  it("handles empty input safely", () => {
    const d = computeDashboard([]);
    expect(d.studentCount).toBe(0);
    expect(d.avgScore).toBe(0);
  });
});

describe("toCSV", () => {
  it("produces header + one row per result", () => {
    const csv = toCSV([makeResult()]);
    const lines = csv.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("studentCode");
    expect(lines[1]).toContain("S001");
  });
  it("escapes commas and quotes", () => {
    const csv = toCSV([makeResult({ reflection: { hardestReason: 'a,"b"', nextGoal: "x", satisfaction: 2 } })]);
    expect(csv).toContain('"a,""b"""');
  });
});

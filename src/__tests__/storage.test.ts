import { describe, it, expect, beforeEach } from "vitest";
import { LocalStorage } from "../lib/storage.local";
import type { ExamResult } from "../core/types";

function makeResult(id: string): ExamResult {
  return {
    id,
    student: { studentCode: "S" + id, name: "n" + id, school: "창동고", grade: "3" },
    exam: { examName: "3월", year: 2026, month: 3, round: 1, totalQuestions: 45, maxScore: 100 },
    teacher: "김민수",
    date: "2026-03-10",
    score: 80,
    wrongAnswers: [],
    reflection: { hardestReason: "x", nextGoal: "y", satisfaction: 3 },
    submittedAt: "2026-03-10T10:00:00.000Z",
  };
}

describe("LocalStorage adapter", () => {
  beforeEach(() => localStorage.clear());

  it("saves and lists results", async () => {
    const s = new LocalStorage();
    await s.saveResult(makeResult("1"));
    await s.saveResult(makeResult("2"));
    const all = await s.listResults();
    expect(all.length).toBe(2);
  });

  it("persists and loads a draft", async () => {
    const s = new LocalStorage();
    await s.saveDraft({ step: 3, teacher: "김민수", score: 70, student: {}, exam: {}, wrongAnswers: [], reflection: {} });
    const d = await s.loadDraft();
    expect(d?.step).toBe(3);
    expect(d?.score).toBe(70);
  });

  it("clears draft", async () => {
    const s = new LocalStorage();
    await s.saveDraft({ step: 1, teacher: "", score: null, student: {}, exam: {}, wrongAnswers: [], reflection: {} });
    await s.clearDraft();
    expect(await s.loadDraft()).toBeNull();
  });
});

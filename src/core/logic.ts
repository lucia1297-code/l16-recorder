import type {
  ExamResult,
  StudentInfo,
  ExamInfo,
  Reflection,
  WrongReason,
} from "./types";
import { WRONG_REASON_LABELS } from "./types";

export function percentScore(score: number, maxScore: number): number {
  if (!maxScore || maxScore <= 0) return 0;
  return Math.round((score / maxScore) * 100);
}

// ===== Validation (returns array of error messages, empty = valid) =====
export function validateStudentInfo(s: Partial<StudentInfo>): string[] {
  const e: string[] = [];
  if (!s.studentCode?.trim()) e.push("학생코드를 입력하세요.");
  if (!s.name?.trim()) e.push("이름을 입력하세요.");
  if (!s.school?.trim()) e.push("학교를 입력하세요.");
  if (!s.grade?.trim()) e.push("학년을 선택하세요.");
  return e;
}

export function validateExamInfo(x: Partial<ExamInfo>): string[] {
  const e: string[] = [];
  if (!x.examName?.trim()) e.push("시험명을 입력하세요.");
  if (!x.year || x.year < 2000) e.push("연도를 확인하세요.");
  if (!x.month || x.month < 1 || x.month > 12) e.push("월을 확인하세요.");
  if (!x.round || x.round < 1) e.push("회차를 확인하세요.");
  if (!x.totalQuestions || x.totalQuestions < 1) e.push("총문항수를 확인하세요.");
  if (!x.maxScore || x.maxScore < 1) e.push("총점(만점)을 확인하세요.");
  return e;
}

export function validateReflection(r: Partial<Reflection>): string[] {
  const e: string[] = [];
  if (!r.hardestReason?.trim()) e.push("가장 어려웠던 이유를 입력하세요.");
  if (!r.nextGoal?.trim()) e.push("다음 시험 목표를 입력하세요.");
  if (!r.satisfaction || r.satisfaction < 1 || r.satisfaction > 5)
    e.push("오늘 시험 만족도를 선택하세요.");
  return e;
}

// ===== Dashboard =====
export interface PerQuestionStat {
  questionNo: number;
  wrongCount: number;
}
export interface PerSchoolStat {
  school: string;
  count: number;
  avgScore: number;
}
export interface ReasonStat {
  reason: WrongReason;
  count: number;
}
export interface Dashboard {
  studentCount: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  wrongRate: number; // 전체 오답 문항 비율(%)
  perQuestion: PerQuestionStat[];
  perSchool: PerSchoolStat[];
  perReason: ReasonStat[];
}

export function computeDashboard(rows: ExamResult[]): Dashboard {
  if (rows.length === 0) {
    return {
      studentCount: 0,
      avgScore: 0,
      maxScore: 0,
      minScore: 0,
      wrongRate: 0,
      perQuestion: [],
      perSchool: [],
      perReason: [],
    };
  }

  const scores = rows.map((r) => r.score);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / rows.length);

  // per question
  const qMap = new Map<number, number>();
  let totalWrong = 0;
  let totalItems = 0;
  for (const r of rows) {
    totalItems += r.exam.totalQuestions || 0;
    for (const w of r.wrongAnswers) {
      qMap.set(w.questionNo, (qMap.get(w.questionNo) ?? 0) + 1);
      totalWrong += 1;
    }
  }
  const perQuestion = [...qMap.entries()]
    .map(([questionNo, wrongCount]) => ({ questionNo, wrongCount }))
    .sort((a, b) => b.wrongCount - a.wrongCount || a.questionNo - b.questionNo);

  // per school
  const sMap = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.student.school || "(미상)";
    const arr = sMap.get(k) ?? [];
    arr.push(r.score);
    sMap.set(k, arr);
  }
  const perSchool = [...sMap.entries()]
    .map(([school, arr]) => ({
      school,
      count: arr.length,
      avgScore: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    }))
    .sort((a, b) => b.count - a.count);

  // per reason
  const rMap = new Map<WrongReason, number>();
  for (const r of rows)
    for (const w of r.wrongAnswers)
      for (const reason of w.reasons)
        rMap.set(reason, (rMap.get(reason) ?? 0) + 1);
  const perReason = [...rMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  return {
    studentCount: rows.length,
    avgScore: avg,
    maxScore: Math.max(...scores),
    minScore: Math.min(...scores),
    wrongRate: totalItems ? Math.round((totalWrong / totalItems) * 100) : 0,
    perQuestion,
    perSchool,
    perReason,
  };
}

// ===== CSV =====
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCSV(rows: ExamResult[]): string {
  const header = [
    "studentCode",
    "name",
    "school",
    "grade",
    "examName",
    "year",
    "month",
    "round",
    "teacher",
    "date",
    "score",
    "maxScore",
    "percent",
    "wrongNumbers",
    "wrongReasons",
    "hardestReason",
    "nextGoal",
    "satisfaction",
    "submittedAt",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const wrongNums = r.wrongAnswers.map((w) => w.questionNo).join(" ");
    const wrongReasons = r.wrongAnswers
      .map(
        (w) =>
          `${w.questionNo}:${w.reasons
            .map((x) => WRONG_REASON_LABELS[x])
            .join("/")}`,
      )
      .join(" | ");
    lines.push(
      [
        r.student.studentCode,
        r.student.name,
        r.student.school,
        r.student.grade,
        r.exam.examName,
        r.exam.year,
        r.exam.month,
        r.exam.round,
        r.teacher,
        r.date,
        r.score,
        r.exam.maxScore,
        percentScore(r.score, r.exam.maxScore),
        wrongNums,
        wrongReasons,
        r.reflection.hardestReason,
        r.reflection.nextGoal,
        r.reflection.satisfaction,
        r.submittedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

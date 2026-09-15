import type { RosterEntry } from "./roster";

export interface TodoScheduleInput {
  studentCode: string;
  subject: string;
  examStart: string;
  examEnd: string;
  englishExamDate: string;
  reportDeadline: string;
  nextLessonDate: string;
}

export type TodoType = "classPrep" | "reportDeadline" | "englishExam" | "examStart" | "examEnd";

export interface TodoItem {
  type: TodoType;
  studentCode?: string;
  message: string;
}

function daysUntil(dateStr: string, today: Date): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const todayOnly = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const targetOnly = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((targetOnly - todayOnly) / 86400000);
}

export function computeTodos(
  schedules: TodoScheduleInput[],
  roster: RosterEntry[],
  today: Date = new Date(),
): TodoItem[] {
  const rosterByCode = new Map(roster.map((r) => [r.studentCode, r]));
  const items: TodoItem[] = [];
  const seenExamStart = new Set<string>();
  const seenExamEnd = new Set<string>();

  for (const ex of schedules) {
    const student = rosterByCode.get(ex.studentCode);
    if (!student) continue;

    if (daysUntil(ex.nextLessonDate, today) === 1) {
      items.push({
        type: "classPrep",
        studentCode: ex.studentCode,
        message: `${student.name} '${ex.subject}' 수업자료 준비가 1일 남았습니다.`,
      });
    }
    if (daysUntil(ex.reportDeadline, today) === 3) {
      items.push({
        type: "reportDeadline",
        studentCode: ex.studentCode,
        message: `${student.name} 직보 예정일이 3일 남았습니다.`,
      });
    }
    if (daysUntil(ex.englishExamDate, today) === 2) {
      items.push({
        type: "englishExam",
        studentCode: ex.studentCode,
        message: `${student.name} 영어시험 이틀 전날입니다.`,
      });
    }
    if (daysUntil(ex.examStart, today) === 0) {
      const key = `${student.school}|${ex.examStart}`;
      if (!seenExamStart.has(key)) {
        seenExamStart.add(key);
        items.push({ type: "examStart", message: `${student.school} 시험 시작일입니다.` });
      }
    }
    if (daysUntil(ex.examEnd, today) === 0) {
      const key = `${student.school}|${ex.examEnd}`;
      if (!seenExamEnd.has(key)) {
        seenExamEnd.add(key);
        items.push({ type: "examEnd", message: `${student.school} 시험 종료일입니다.` });
      }
    }
  }
  return items;
}

export function formatDailyDigest(items: TodoItem[]): string {
  return items.map((i) => i.message).join("\n");
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface UpcomingTodoItem extends TodoItem {
  date: string; // YYYY-MM-DD — 이 항목이 해당되는 날짜
}

/**
 * startDate부터 days일 동안, 하루하루 computeTodos를 돌려서 모은 결과.
 * 날짜 하나만 확인하고 싶으면 computeTodos를, 기간(예: 일주일)을 훑어보고
 * 싶으면 이 함수를 쓴다.
 */
export function computeUpcomingTodos(
  schedules: TodoScheduleInput[],
  roster: RosterEntry[],
  startDate: Date = new Date(),
  days: number = 7,
): UpcomingTodoItem[] {
  const results: UpcomingTodoItem[] = [];
  for (let offset = 0; offset < days; offset++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + offset);
    const dateStr = toDateStr(d);
    for (const item of computeTodos(schedules, roster, d)) {
      results.push({ ...item, date: dateStr });
    }
  }
  return results;
}

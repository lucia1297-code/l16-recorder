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

export type TodoType =
  | "classPrep"
  | "reportDeadline"
  | "englishExam"
  | "examStart"
  | "examEnd"
  | "lessonPrep"
  | "scheduleEvent"
  | "wwOrder"
  | "material";

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

// Date.getDay() 결과(0=일요일)와 순서가 일치한다 — src/core/roster.ts의 WEEKDAY_ORDER와 동일
const WEEKDAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** 정기 수업(매주 반복, students.lessonSchedule) — 내일이 수업 요일이면 자료 준비 알림 */
export function computeLessonReminders(
  roster: RosterEntry[],
  today: Date = new Date(),
): TodoItem[] {
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const tomorrowDow = WEEKDAY_ORDER[tomorrow.getDay()];
  const items: TodoItem[] = [];
  for (const r of roster) {
    if (!r.lessonSchedule || r.lessonSchedule.length === 0) continue;
    const hasLesson = r.lessonSchedule.some((l) => l.day === tomorrowDow);
    if (hasLesson) {
      items.push({
        type: "lessonPrep",
        studentCode: r.studentCode,
        message: `${r.name} 내일 정규수업이 있습니다 — 자료 준비하세요.`,
      });
    }
  }
  return items;
}

/** 일정관리(SchedulePanel, student_schedules 테이블) — 예정 상태인 일정이 내일이면 알림 */
export interface ScheduleEventInput {
  studentCode: string | null;
  studentName: string | null;
  eventDate: string;
  category: string;
  title: string;
  status: string;
}
export function computeScheduleReminders(
  events: ScheduleEventInput[],
  today: Date = new Date(),
): TodoItem[] {
  const items: TodoItem[] = [];
  for (const e of events) {
    if (e.status !== "예정") continue;
    if (daysUntil(e.eventDate, today) !== 1) continue;
    const who = e.studentName ? `${e.studentName} ` : "";
    items.push({
      type: "scheduleEvent",
      studentCode: e.studentCode ?? undefined,
      message: `${who}${e.title}(${e.category}) 일정이 내일입니다.`,
    });
  }
  return items;
}

/** 시험지 주문(WWOrderPanel, ww_orders 테이블) — 완료되지 않은 주문의 시험일이 3일 남으면 알림 */
export interface WwOrderInput {
  studentCode: string;
  studentName: string;
  examDate: string;
  status: string;
}
export function computeWwOrderReminders(
  orders: WwOrderInput[],
  today: Date = new Date(),
): TodoItem[] {
  const items: TodoItem[] = [];
  for (const o of orders) {
    if (o.status === "done") continue;
    if (daysUntil(o.examDate, today) !== 3) continue;
    items.push({
      type: "wwOrder",
      studentCode: o.studentCode,
      message: `${o.studentName} 시험지 주문 시험일이 3일 남았습니다.`,
    });
  }
  return items;
}

/** 자료 제공(MaterialPanel, material_records 테이블) — 배부예정 건의 제공일이 하루 남으면 알림 */
export interface MaterialInput {
  studentCode: string;
  studentName: string;
  providedAt: string;
  materialType: string;
  status: string;
}
export function computeMaterialReminders(
  records: MaterialInput[],
  today: Date = new Date(),
): TodoItem[] {
  const items: TodoItem[] = [];
  for (const m of records) {
    if (m.status !== "배부예정") continue;
    if (daysUntil(m.providedAt, today) !== 1) continue;
    items.push({
      type: "material",
      studentCode: m.studentCode,
      message: `${m.studentName} '${m.materialType}' 자료 배부 예정일이 1일 남았습니다.`,
    });
  }
  return items;
}

export interface AllTodoInputs {
  schedules: TodoScheduleInput[];
  roster: RosterEntry[];
  scheduleEvents?: ScheduleEventInput[];
  wwOrders?: WwOrderInput[];
  materials?: MaterialInput[];
}

/** 시험일정 + 정기수업 + 일정관리 + 시험지주문 + 자료배부, 전부 합쳐서 그날의 할일을 계산한다 */
export function computeAllTodos(input: AllTodoInputs, today: Date = new Date()): TodoItem[] {
  return [
    ...computeTodos(input.schedules, input.roster, today),
    ...computeLessonReminders(input.roster, today),
    ...computeScheduleReminders(input.scheduleEvents ?? [], today),
    ...computeWwOrderReminders(input.wwOrders ?? [], today),
    ...computeMaterialReminders(input.materials ?? [], today),
  ];
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
 * startDate부터 days일 동안, 하루하루 computeAllTodos를 돌려서 모은 결과.
 * 날짜 하나만 확인하고 싶으면 computeAllTodos를, 기간(예: 일주일)을 훑어보고
 * 싶으면 이 함수를 쓴다.
 */
export function computeUpcomingTodos(
  input: AllTodoInputs,
  startDate: Date = new Date(),
  days: number = 7,
): UpcomingTodoItem[] {
  const results: UpcomingTodoItem[] = [];
  for (let offset = 0; offset < days; offset++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + offset);
    const dateStr = toDateStr(d);
    for (const item of computeAllTodos(input, d)) {
      results.push({ ...item, date: dateStr });
    }
  }
  return results;
}

import {
  computeAllTodos, computeUpcomingTodos, formatDailyDigest, toDateStr,
  type AllTodoInputs, type MaterialInput, type ScheduleEventInput,
  type TodoItem, type TodoScheduleInput, type UpcomingTodoItem, type WwOrderInput,
} from "../../core/todoRules";
import { createRosterStore } from "../../lib/rosterStoreFactory";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const MEMOS_KEY = "l16_memos";
const LAST_RUN_KEY = "l16_todo_last_date";

async function fetchSchedules(): Promise<TodoScheduleInput[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/admin_exam_schedules?select=student_code,subject,exam_start,exam_end,english_exam_date,report_deadline,next_lesson_date`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`admin_exam_schedules fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? "",
    subject: r.subject ?? "",
    examStart: r.exam_start ?? "",
    examEnd: r.exam_end ?? "",
    englishExamDate: r.english_exam_date ?? "",
    reportDeadline: r.report_deadline ?? "",
    nextLessonDate: r.next_lesson_date ?? "",
  }));
}

async function fetchScheduleEvents(): Promise<ScheduleEventInput[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/student_schedules?select=student_code,student_name,event_date,category,title,status`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`student_schedules fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? null,
    studentName: r.student_name ?? null,
    eventDate: r.event_date ?? "",
    category: r.category ?? "",
    title: r.title ?? "",
    status: r.status ?? "",
  }));
}

async function fetchWwOrders(): Promise<WwOrderInput[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ww_orders?select=student_code,student_name,exam_date,status`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`ww_orders fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? "",
    studentName: r.student_name ?? "",
    examDate: r.exam_date ?? "",
    status: r.status ?? "",
  }));
}

async function fetchMaterials(): Promise<MaterialInput[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/material_records?select=student_code,student_name,provided_at,material_type,status`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`material_records fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? "",
    studentName: r.student_name ?? "",
    providedAt: r.provided_at ?? "",
    materialType: r.material_type ?? "",
    status: r.status ?? "",
  }));
}

async function fetchAllTodoInputs(): Promise<AllTodoInputs> {
  const [schedules, roster, scheduleEvents, wwOrders, materials] = await Promise.all([
    fetchSchedules(),
    createRosterStore().listRoster(),
    fetchScheduleEvents(),
    fetchWwOrders(),
    fetchMaterials(),
  ]);
  return { schedules, roster, scheduleEvents, wwOrders, materials };
}

function upsertMemo(id: string, title: string, digest: string): string {
  const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
  const now = new Date().toISOString();
  const next = [
    { id, title, body: digest, tag: "할일", alarm: "", createdAt: now, updatedAt: now },
    ...memos.filter((m: { id: string }) => m.id !== id),
  ];
  localStorage.setItem(MEMOS_KEY, JSON.stringify(next));
  return id;
}

export interface DailyTodoResult {
  items: TodoItem[];
  memoId: string | null;
}

/**
 * 오늘의 할일을 계산해서 메모로 남긴다.
 * force가 아니면 하루 한 번만 계산(캐시된 결과는 재사용 안 하고 그냥 스킵) —
 * 관리자 로그인 시 자동 호출용. force가 true면 캐시 무시하고 항상 다시 계산 —
 * "지금 확인" 버튼용.
 */
export async function ensureDailyTodoMemo(
  today: Date = new Date(),
  force = false,
): Promise<DailyTodoResult> {
  const dateStr = toDateStr(today);
  if (!force && localStorage.getItem(LAST_RUN_KEY) === dateStr) return { items: [], memoId: null };

  const input = await fetchAllTodoInputs();
  const items = computeAllTodos(input, today);
  localStorage.setItem(LAST_RUN_KEY, dateStr);
  const memoId = items.length > 0
    ? upsertMemo(`todo-${dateStr}`, `오늘의 할일 (${dateStr})`, formatDailyDigest(items))
    : null;
  return { items, memoId };
}

export interface WeekTodoResult {
  items: UpcomingTodoItem[];
  memoId: string | null;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/**
 * startDate부터 days일(기본 일주일) 동안 해당되는 할일을 훑어서 메모 하나로
 * 남긴다. "지금 확인"과 달리 하루 제한 없이 언제든 원하는 시작일로 다시
 * 돌릴 수 있다 — 날짜별로 [YYYY-MM-DD] 접두어를 붙여 한 메모에 모아 보여준다.
 */
export async function checkUpcomingWeek(
  startDate: Date = new Date(),
  days = 7,
): Promise<WeekTodoResult> {
  const input = await fetchAllTodoInputs();
  const items = computeUpcomingTodos(input, startDate, days);
  if (items.length === 0) return { items: [], memoId: null };

  const startStr = toDateStr(startDate);
  const endStr = toDateStr(addDays(startDate, days - 1));
  const digest = items.map((i) => `[${i.date}] ${i.message}`).join("\n");
  const memoId = upsertMemo(`todo-week-${startStr}`, `이번 주 할일 (${startStr} ~ ${endStr})`, digest);
  return { items, memoId };
}

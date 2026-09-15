import { computeTodos, formatDailyDigest, type TodoItem, type TodoScheduleInput } from "../../core/todoRules";
import { createRosterStore } from "../../lib/rosterStoreFactory";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const MEMOS_KEY = "l16_memos";
const LAST_RUN_KEY = "l16_todo_last_date";

function todayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

function upsertTodoMemo(dateStr: string, digest: string): string {
  const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
  const id = `todo-${dateStr}`;
  const now = new Date().toISOString();
  const next = [
    { id, title: `오늘의 할일 (${dateStr})`, body: digest, tag: "할일", alarm: "", createdAt: now, updatedAt: now },
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
  const dateStr = todayStr(today);
  if (!force && localStorage.getItem(LAST_RUN_KEY) === dateStr) return { items: [], memoId: null };

  const [schedules, roster] = await Promise.all([fetchSchedules(), createRosterStore().listRoster()]);
  const items = computeTodos(schedules, roster, today);
  localStorage.setItem(LAST_RUN_KEY, dateStr);
  const memoId = items.length > 0 ? upsertTodoMemo(dateStr, formatDailyDigest(items)) : null;
  return { items, memoId };
}

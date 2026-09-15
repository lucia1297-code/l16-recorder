import { computeAllTodos, formatDailyDigest, type AllTodoInputs, type MaterialInput, type ScheduleEventInput, type TodoScheduleInput, type WwOrderInput } from "../src/core/todoRules";
import { SolapiSmsProvider } from "../src/lib/sms.solapi";
import type { RosterEntry } from "../src/core/roster";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const SB_H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

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

async function fetchRoster(): Promise<RosterEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/students?select=student_code,name,school,grade,phone,parent_phone,teacher,note,lesson_schedule`,
    { headers: SB_H },
  );
  if (!res.ok) throw new Error(`students fetch 실패 (${res.status})`);
  const rows = await res.json();
  return (rows as any[]).map((r) => ({
    studentCode: r.student_code ?? "",
    name: r.name ?? "",
    school: r.school ?? "",
    grade: r.grade ?? "",
    phone: r.phone ?? "",
    parentPhone: r.parent_phone ?? "",
    teacher: r.teacher ?? "",
    note: r.note ?? "",
    lessonSchedule: (() => {
      try { return JSON.parse(r.lesson_schedule || "[]"); } catch { return []; }
    })(),
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

/** 소스 하나(예: 아직 없는 테이블)가 실패해도 나머지는 계속 계산하도록 격리한다 */
async function safeFetch<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`${label} 조회 실패 — 이 소스는 건너뜁니다:`, e);
    return [];
  }
}

async function main() {
  const [schedules, roster, scheduleEvents, wwOrders, materials] = await Promise.all([
    safeFetch("시험일정", fetchSchedules),
    fetchRoster(),
    safeFetch("일정관리", fetchScheduleEvents),
    safeFetch("시험지 주문", fetchWwOrders),
    safeFetch("자료 배부", fetchMaterials),
  ]);
  const input: AllTodoInputs = { schedules, roster, scheduleEvents, wwOrders, materials };
  const items = computeAllTodos(input, new Date());

  if (items.length === 0) {
    console.log("오늘 발송할 할일이 없습니다. 문자 발송을 건너뜁니다.");
    return;
  }

  const digest = formatDailyDigest(items);
  const adminPhone = process.env.VITE_ADMIN_PHONE ?? "";
  if (!adminPhone) throw new Error("VITE_ADMIN_PHONE이 설정되지 않았습니다.");

  const provider = new SolapiSmsProvider(
    process.env.VITE_SOLAPI_API_KEY ?? "",
    process.env.VITE_SOLAPI_API_SECRET ?? "",
    process.env.VITE_SOLAPI_SENDER ?? "",
  );
  await provider.send(adminPhone, `[L16] 오늘의 할일\n${digest}`);
  console.log(`문자 발송 완료 (${items.length}건):\n${digest}`);
}

main().catch((err) => {
  console.error("일일 TODO 문자 발송 실패:", err);
  process.exit(1);
});

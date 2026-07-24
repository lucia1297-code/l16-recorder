import type { TeacherLogStore } from "./teacherLogStore";
import type { TeacherLog } from "../core/teacherLog";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  cachedClient = createClient(url, key);
  return cachedClient;
}

/**
 * teacher_logs 테이블 사용. 학생은 이 데이터에 전혀 접근하지 못하고(관리자 전용),
 * rows/examRecords 는 구조가 자유로워 jsonb 컬럼 하나로 통째로 저장한다.
 */
export class SupabaseTeacherLogStore implements TeacherLogStore {
  async saveLog(log: TeacherLog): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("teacher_logs").upsert(
      {
        id: log.id,
        student_code: log.studentCode,
        date: log.date,
        rows: log.rows,
        exam_records: log.examRecords,
        notes: log.notes,
        next_plan: log.nextPlan,
        class_content: log.classContent,
      },
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  async listLogsForStudent(studentCode: string): Promise<TeacherLog[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("teacher_logs")
      .select("*")
      .eq("student_code", studentCode)
      .order("date", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }

  async getLog(studentCode: string, date: string): Promise<TeacherLog | null> {
    const sb = getClient();
    const { data, error } = await sb
      .from("teacher_logs")
      .select("*")
      .eq("student_code", studentCode)
      .eq("date", date)
      .maybeSingle();
    if (error || !data) return null;
    return mapRow(data);
  }
}

function mapRow(r: any): TeacherLog {
  return {
    id: r.id,
    studentCode: r.student_code,
    date: r.date,
    rows: r.rows ?? [],
    examRecords: r.exam_records ?? [],
    notes: r.notes ?? "",
    nextPlan: r.next_plan ?? "",
    classContent: r.class_content ?? "",
  };
}

import type { ExamCheckStore } from "./examCheckStore";
import type { ExamCheckRecord } from "../core/examCheck";
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

export class SupabaseExamCheckStore implements ExamCheckStore {
  async submit(record: ExamCheckRecord): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("exam_checks").insert({
      id: record.id,
      student_code: record.studentCode,
      student_name: record.studentName,
      answer: record.answer,
      answered_at: record.answeredAt,
    });
    if (error) throw error;
  }

  async listAll(): Promise<ExamCheckRecord[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("exam_checks")
      .select("*")
      .order("answered_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      studentCode: r.student_code,
      studentName: r.student_name,
      answer: r.answer,
      answeredAt: r.answered_at,
    }));
  }
}

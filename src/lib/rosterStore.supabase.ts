import type { RosterStore } from "./rosterStore";
import type { RosterEntry } from "../core/roster";
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
 * students 테이블 사용 (supabase/schema.sql 참고).
 * 조회(select)/삽입(upsert) 모두 관리자(로그인된 사용자)만 가능하도록 RLS 설정 권장.
 */
export class SupabaseRosterStore implements RosterStore {
  async saveRoster(entries: RosterEntry[]): Promise<void> {
    const sb = getClient();
    const rows = entries.map((e) => ({
      student_code: e.studentCode,
      name: e.name,
      school: e.school,
      grade: e.grade,
      phone: e.phone,
      parent_phone: e.parentPhone,
      teacher: e.teacher,
      note: e.note,
      registered_at: e.registeredAt,
      student_type: e.studentType ?? "",
      exclude_from_reminder: e.excludeFromReminder ?? false,
    }));
    const { error } = await sb.from("students").upsert(rows, { onConflict: "student_code" });
    if (error) throw error;
  }

  async listRoster(): Promise<RosterEntry[]> {
    const sb = getClient();
    const { data, error } = await sb.from("students").select("*").order("student_code");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      studentCode: r.student_code,
      name: r.name,
      school: r.school,
      grade: r.grade,
      phone: r.phone,
      parentPhone: r.parent_phone ?? undefined,
      teacher: r.teacher ?? "",
      note: r.note ?? "",
      registeredAt: r.registered_at ?? undefined,
      studentType: (r.student_type ?? "") as "S" | "W2" | "W1" | "",
      excludeFromReminder: r.exclude_from_reminder ?? false,
    }));
  }

  async findByPhone(phoneDigits: string): Promise<RosterEntry | null> {
    const sb = getClient();
    const { data, error } = await sb
      .from("students")
      .select("*")
      .eq("phone", phoneDigits)
      .maybeSingle();
    if (error || !data) return null;
    return {
      studentCode: data.student_code,
      name: data.name,
      school: data.school,
      grade: data.grade,
      phone: data.phone,
      parentPhone: data.parent_phone ?? undefined,
      teacher: data.teacher ?? "",
      note: data.note ?? "",
      registeredAt: data.registered_at ?? undefined,
    };
  }

  async clearRoster(): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("students").delete().neq("student_code", "");
    if (error) throw error;
  }
}

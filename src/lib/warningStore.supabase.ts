import type { WarningStore } from "./warningStore";
import type { WarningRecord } from "../core/warning";
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
 * assignment_warnings 테이블 사용 — (student_code, type_id) 복합 기본키.
 */
export class SupabaseWarningStore implements WarningStore {
  async listAll(): Promise<WarningRecord[]> {
    const sb = getClient();
    const { data, error } = await sb.from("assignment_warnings").select("*");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      studentCode: r.student_code,
      typeId: r.type_id,
      count: r.count,
      lastWarnedAt: r.last_warned_at,
    }));
  }

  async saveAll(records: WarningRecord[]): Promise<void> {
    const sb = getClient();
    const rows = records.map((r) => ({
      student_code: r.studentCode,
      type_id: r.typeId,
      count: r.count,
      last_warned_at: r.lastWarnedAt,
    }));
    const { error } = await sb
      .from("assignment_warnings")
      .upsert(rows, { onConflict: "student_code,type_id" });
    if (error) throw error;
  }
}

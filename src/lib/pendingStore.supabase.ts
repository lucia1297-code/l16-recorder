import type { PendingStore } from "./pendingStore";
import type { PendingRegistration } from "../core/pendingRegistration";
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
 * pending_registrations 테이블 사용 (supabase/schema.sql 참고).
 * insert 는 익명(학생 본인) 허용, 조회/승인/거부(삭제)는 관리자만 가능하도록 RLS 설정.
 */
export class SupabasePendingStore implements PendingStore {
  async submit(entry: PendingRegistration): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("pending_registrations").upsert(
      {
        phone: entry.phone,
        name: entry.name,
        school: entry.school,
        grade: entry.grade,
        requested_at: entry.requestedAt,
      },
      { onConflict: "phone" },
    );
    if (error) throw error;
  }

  async listPending(): Promise<PendingRegistration[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("pending_registrations")
      .select("*")
      .order("requested_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      phone: r.phone,
      name: r.name,
      school: r.school,
      grade: r.grade,
      requestedAt: r.requested_at,
    }));
  }

  async findByPhone(phoneDigits: string): Promise<PendingRegistration | null> {
    const sb = getClient();
    const { data, error } = await sb
      .from("pending_registrations")
      .select("*")
      .eq("phone", phoneDigits)
      .maybeSingle();
    if (error || !data) return null;
    return {
      phone: data.phone,
      name: data.name,
      school: data.school,
      grade: data.grade,
      requestedAt: data.requested_at,
    };
  }

  async approve(phoneDigits: string, studentCode: string): Promise<RosterEntry | null> {
    const found = await this.findByPhone(phoneDigits);
    if (!found) return null;
    const sb = getClient();
    await sb.from("pending_registrations").delete().eq("phone", phoneDigits);
    return {
      studentCode,
      name: found.name,
      school: found.school,
      grade: found.grade,
      phone: found.phone,
      teacher: "",
      note: "학생 자가등록 승인",
    };
  }

  async reject(phoneDigits: string): Promise<void> {
    const sb = getClient();
    await sb.from("pending_registrations").delete().eq("phone", phoneDigits);
  }
}

import type { AssignmentStore } from "./assignmentStore";
import type { AssignmentType, AssignmentSubmission } from "../core/assignment";
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
 * assignment_types / assignment_submissions 테이블 사용 (supabase/schema.sql 참고).
 */
export class SupabaseAssignmentStore implements AssignmentStore {
  async listTypes(): Promise<AssignmentType[]> {
    const sb = getClient();
    const { data, error } = await sb.from("assignment_types").select("*").order("name");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      targetCount: r.target_count,
    }));
  }

  async saveType(type: AssignmentType): Promise<void> {
    const sb = getClient();
    const { error } = await sb
      .from("assignment_types")
      .upsert({ id: type.id, name: type.name, target_count: type.targetCount }, { onConflict: "id" });
    if (error) throw error;
  }

  async deleteType(id: string): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("assignment_types").delete().eq("id", id);
    if (error) throw error;
  }

  async submit(entry: AssignmentSubmission): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("assignment_submissions").insert({
      id: entry.id,
      student_code: entry.studentCode,
      type_id: entry.typeId,
      round: entry.round,
      score: entry.score,
      wrong_numbers: entry.wrongNumbers,
      submitted_at: entry.submittedAt,
    });
    if (error) throw error;
  }

  async listSubmissions(): Promise<AssignmentSubmission[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("assignment_submissions")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }

  async listSubmissionsForStudent(studentCode: string): Promise<AssignmentSubmission[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("assignment_submissions")
      .select("*")
      .eq("student_code", studentCode)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }
}

function mapRow(r: any): AssignmentSubmission {
  return {
    id: r.id,
    studentCode: r.student_code,
    typeId: r.type_id,
    round: r.round,
    score: r.score,
    wrongNumbers: r.wrong_numbers ?? [],
    submittedAt: r.submitted_at,
  };
}

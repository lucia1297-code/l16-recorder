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
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      targetCount: r.target_count,
      kind: r.kind ?? undefined,
      itemLabel: r.item_label ?? undefined,
      scopeLabel: r.scope_label ?? undefined,
      completedLabel: r.completed_label ?? undefined,
    }));
  }

  async saveType(type: AssignmentType): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("assignment_types").upsert(
      {
        id: type.id,
        name: type.name,
        target_count: type.targetCount,
        kind: type.kind ?? null,
        item_label: type.itemLabel ?? null,
        scope_label: type.scopeLabel ?? null,
        completed_label: type.completedLabel ?? null,
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
  }

  async deleteType(id: string): Promise<void> {
    const sb = getClient();
    const { error } = await sb.from("assignment_types").delete().eq("id", id);
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
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
      total_minutes: entry.totalMinutes,
      step1_minutes: entry.step1Minutes,
      step2_minutes: entry.step2Minutes,
      step3_minutes: entry.step3Minutes,
      item: entry.item,
      scope: entry.scope,
      completed: entry.completed,
      review_status: entry.reviewStatus ?? "pending",
    });
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
  }

  async updateSubmission(id: string, patch: Partial<AssignmentSubmission>): Promise<void> {
    const sb = getClient();
    const row: Record<string, unknown> = {};
    if (patch.score !== undefined) row.score = patch.score;
    if (patch.wrongNumbers !== undefined) row.wrong_numbers = patch.wrongNumbers;
    if (patch.round !== undefined) row.round = patch.round;
    if (patch.totalMinutes !== undefined) row.total_minutes = patch.totalMinutes;
    if (patch.step1Minutes !== undefined) row.step1_minutes = patch.step1Minutes;
    if (patch.step2Minutes !== undefined) row.step2_minutes = patch.step2Minutes;
    if (patch.step3Minutes !== undefined) row.step3_minutes = patch.step3Minutes;
    if (patch.item !== undefined) row.item = patch.item;
    if (patch.scope !== undefined) row.scope = patch.scope;
    if (patch.completed !== undefined) row.completed = patch.completed;
    if (patch.reviewStatus !== undefined) row.review_status = patch.reviewStatus;
    if (patch.reviewedAt !== undefined) row.reviewed_at = patch.reviewedAt;
    if (patch.reviewNote !== undefined) row.review_note = patch.reviewNote;
    const { error } = await sb.from("assignment_submissions").update(row).eq("id", id);
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
  }

  async listSubmissions(): Promise<AssignmentSubmission[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("assignment_submissions")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
    return (data ?? []).map(mapRow);
  }

  async listSubmissionsForStudent(studentCode: string): Promise<AssignmentSubmission[]> {
    const sb = getClient();
    const { data, error } = await sb
      .from("assignment_submissions")
      .select("*")
      .eq("student_code", studentCode)
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
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
    totalMinutes: r.total_minutes ?? undefined,
    step1Minutes: r.step1_minutes ?? undefined,
    step2Minutes: r.step2_minutes ?? undefined,
    step3Minutes: r.step3_minutes ?? undefined,
    item: r.item ?? undefined,
    scope: r.scope ?? undefined,
    completed: r.completed ?? undefined,
    reviewStatus: r.review_status ?? undefined,
    reviewedAt: r.reviewed_at ?? undefined,
    reviewNote: r.review_note ?? undefined,
  };
}

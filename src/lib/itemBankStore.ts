// 문항 실측·검수 저장소 (Supabase). 순수 계산은 core/itemAnalytics.ts 참고.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Item, ItemStatus, Response } from "../core/itemAnalytics";

let cached: SupabaseClient | null = null;
function client(): SupabaseClient {
  if (cached) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다.");
  cached = createClient(url, key);
  return cached;
}

/** 시험 회차. 학생 앱은 이 표만 읽고 item_bank(정답 포함)는 읽지 않는다. */
export interface ExamSession {
  id: string;
  setName: string;
  sessionName: string;
  school: string;
  questionCount: number;
  isOpen: boolean;
}

export interface ReviewRow {
  id: string;
  itemId: string;
  stage: "auto" | "ai" | "owner" | "report";
  result: "pass" | "fail" | "note";
  note: string;
  createdAt: string;
}

// Supabase 기본 조회 한도(1000행)를 넘는 응시 데이터를 위해 페이지 단위로 읽는다.
async function fetchAll<T>(table: string, order: string): Promise<any[]> {
  const sb = client();
  const out: any[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .order(order)
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

export const itemBankStore = {
  async listItems(): Promise<Item[]> {
    const rows = await fetchAll("item_bank", "id");
    return rows.map((r) => ({
      id: r.id,
      setName: r.set_name,
      school: r.school,
      questionNo: r.question_no,
      source: r.source,
      points: Number(r.points),
      answer: r.answer,
      axes: r.axes ?? {},
      status: r.status as ItemStatus,
    }));
  },

  async listResponses(): Promise<Response[]> {
    const rows = await fetchAll("item_responses", "id");
    return rows.map((r) => ({
      itemId: r.item_id,
      studentCode: r.student_code,
      chosen: r.chosen,
      session: r.session,
    }));
  },

  async listReviews(): Promise<ReviewRow[]> {
    const rows = await fetchAll("item_reviews", "created_at");
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      stage: r.stage,
      result: r.result,
      note: r.note,
      createdAt: r.created_at,
    }));
  },

  // ── 시험 회차 ──
  async listSessions(): Promise<ExamSession[]> {
    const rows = await fetchAll("item_sessions", "created_at");
    return rows.map((r) => ({
      id: r.id,
      setName: r.set_name,
      sessionName: r.session_name,
      school: r.school,
      questionCount: r.question_count,
      isOpen: r.is_open,
    }));
  },

  /** 학생 앱용: 열려 있는 회차만. 문항 정답은 내려오지 않는다. */
  async listOpenSessions(): Promise<ExamSession[]> {
    const { data, error } = await client()
      .from("item_sessions")
      .select("id,set_name,session_name,school,question_count,is_open")
      .eq("is_open", true)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      setName: r.set_name,
      sessionName: r.session_name,
      school: r.school,
      questionCount: r.question_count,
      isOpen: r.is_open,
    }));
  },

  async createSession(
    setName: string,
    sessionName: string,
    school: string,
    questionCount: number,
  ): Promise<void> {
    const { error } = await client().from("item_sessions").upsert(
      {
        set_name: setName,
        session_name: sessionName,
        school,
        question_count: questionCount,
        is_open: true,
      },
      { onConflict: "set_name,session_name" },
    );
    if (error) throw error;
  },

  async setSessionOpen(id: string, isOpen: boolean): Promise<void> {
    const { error } = await client().from("item_sessions").update({ is_open: isOpen }).eq("id", id);
    if (error) throw error;
  },

  async deleteSession(id: string): Promise<void> {
    const { error } = await client().from("item_sessions").delete().eq("id", id);
    if (error) throw error;
  },

  /** 학생 앱용 문항 목록 — 번호와 ID만. 정답(answer)은 내려받지 않는다. */
  async listSessionItems(setName: string): Promise<{ id: string; questionNo: number }[]> {
    const { data, error } = await client()
      .from("item_bank")
      .select("id,question_no")
      .eq("set_name", setName)
      .order("question_no");
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, questionNo: r.question_no }));
  },

  /** 학생이 이미 낸 답안 (수정 제출용). 문항 ID 기준. */
  async myAnswers(studentCode: string, sessionName: string): Promise<Record<string, string>> {
    const { data, error } = await client()
      .from("item_responses")
      .select("item_id,chosen")
      .eq("student_code", studentCode)
      .eq("session", sessionName);
    if (error) throw error;
    const out: Record<string, string> = {};
    for (const r of data ?? []) out[r.item_id as string] = r.chosen as string;
    return out;
  },

  /** 회차별 응시 인원 (관리자 화면 표시용) */
  async countBySession(): Promise<Record<string, number>> {
    const { data, error } = await client().from("item_responses").select("session,student_code");
    if (error) throw error;
    const seen = new Map<string, Set<string>>();
    for (const r of data ?? []) {
      const k = r.session as string;
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k)!.add(r.student_code as string);
    }
    const out: Record<string, number> = {};
    for (const [k, v] of seen) out[k] = v.size;
    return out;
  },

  async upsertItems(items: Item[]): Promise<void> {
    if (items.length === 0) return;
    const { error } = await client()
      .from("item_bank")
      .upsert(
        items.map((i) => ({
          id: i.id,
          set_name: i.setName,
          school: i.school,
          question_no: i.questionNo,
          source: i.source,
          points: i.points,
          answer: i.answer,
          axes: i.axes,
          updated_at: new Date().toISOString(),
          // status는 일부러 보내지 않는다: 재등록해도 검수 상태가 초기화되지 않게 함
        })),
        { onConflict: "id" },
      );
    if (error) throw error;
  },

  async upsertResponses(rows: Response[]): Promise<void> {
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      const { error } = await client()
        .from("item_responses")
        .upsert(
          rows.slice(i, i + chunk).map((r) => ({
            item_id: r.itemId,
            student_code: r.studentCode,
            chosen: r.chosen,
            session: r.session,
          })),
          { onConflict: "item_id,student_code,session" },
        );
      if (error) throw error;
    }
  },

  async setStatus(itemId: string, status: ItemStatus): Promise<void> {
    const { error } = await client()
      .from("item_bank")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", itemId);
    if (error) throw error;
  },

  async addReview(
    itemId: string,
    stage: ReviewRow["stage"],
    result: ReviewRow["result"],
    note: string,
  ): Promise<void> {
    const { error } = await client()
      .from("item_reviews")
      .insert({ item_id: itemId, stage, result, note });
    if (error) throw error;
  },
};

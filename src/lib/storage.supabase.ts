import type { Storage } from "./storage";
import type { ExamResult, DraftResult } from "../core/types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 구현체.
 * 사용법:
 *   1) .env 에 VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 설정
 *   2) supabase/schema.sql 을 Supabase SQL 에디터에서 실행
 *   3) storageFactory.ts 가 두 값이 설정된 것을 감지하면 자동으로 이 클래스를 사용
 *
 * 초안(작성중)은 개별 학생 브라우저에 두는 게 자연스러워서 여기서도 localStorage 사용.
 * 최종 제출(results)만 Supabase 로 저장한다.
 */
const DRAFT_KEY = "asx.draft";
let cachedClient: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) {
    throw new Error(
      "Supabase 환경변수(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)가 없습니다.",
    );
  }
  cachedClient = createClient(url, key);
  return cachedClient;
}

export class SupabaseStorage implements Storage {
  async saveResult(r: ExamResult): Promise<void> {
    const sb = await getClient();
    // 정규화된 여러 테이블 대신, MVP 는 단일 results 테이블 + jsonb 컬럼으로 저장.
    // (schema.sql 참고: 정규화 테이블도 함께 제공)
    const { error } = await sb.from("results").insert({
      id: r.id,
      student_code: r.student.studentCode,
      name: r.student.name,
      school: r.student.school,
      grade: r.student.grade,
      exam_name: r.exam.examName,
      year: r.exam.year,
      month: r.exam.month,
      round: r.exam.round,
      total_questions: r.exam.totalQuestions,
      max_score: r.exam.maxScore,
      teacher: r.teacher,
      date: r.date,
      score: r.score,
      wrong_answers: r.wrongAnswers,
      reflection: r.reflection,
      question_details: r.questionDetails ?? [],
      submitted_at: r.submittedAt,
    });
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
  }

  async listResults(): Promise<ExamResult[]> {
    const sb = await getClient();
    const { data, error } = await sb
      .from("results")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message ?? error.details ?? JSON.stringify(error));
    return (data ?? []).map((row: any) => ({
      id: row.id,
      student: {
        studentCode: row.student_code,
        name: row.name,
        school: row.school,
        grade: row.grade,
      },
      exam: {
        examName: row.exam_name,
        year: row.year,
        month: row.month,
        round: row.round,
        totalQuestions: row.total_questions,
        maxScore: row.max_score,
      },
      teacher: row.teacher,
      date: row.date,
      score: row.score,
      wrongAnswers: row.wrong_answers ?? [],
      reflection: row.reflection,
      submittedAt: row.submitted_at,
    }));
  }

  async saveDraft(d: DraftResult): Promise<void> {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  }
  async loadDraft(): Promise<DraftResult | null> {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? ((()=>{ try { return JSON.parse(raw); } catch { return null; } })() as DraftResult) : null;
  }
  async clearDraft(): Promise<void> {
    localStorage.removeItem(DRAFT_KEY);
  }
}

// ════════════════════════════════════════════════════════
// L16 ↔ AFX-Desk (L19) 데이터 브리지
// 두 시스템이 공유하는 데이터 변환 및 동기화 유틸리티
//
// L16 (Supabase)  ←→  AFX-Desk (Neon PostgreSQL)
// ════════════════════════════════════════════════════════

/**
 * 시스템 간 공유 데이터 구조
 *
 * L16 Supabase              AFX-Desk Neon/PostgreSQL
 * ─────────────────────     ────────────────────────────
 * roster (localStorage)  ←→  students + asx_roster_imports
 * results                ←→  learning_records + asx_exam_results
 * assignment_submissions  ←→  asx_assignment_submissions
 * lesson_recordings      →   learning_records (notes)
 * exam_prep_plans        →   schedules
 * consultation_messages  →   sms_notifications (대기열)
 * sms (Solapi)           ←   sms_notifications (AFX 승인 후 발송)
 */

// ── 학생 코드 연결 키 ─────────────────────────────────
// AFX-Desk students.notes 에 "ASX 학생코드: {code}" 형식으로 저장
// L16 roster.studentCode 와 매핑
export const AFX_STUDENT_CODE_PREFIX = "ASX 학생코드: ";

export function extractAfxStudentCode(notes: string | null): string | null {
  if (!notes) return null;
  const line = notes.split("\n").find(l => l.startsWith(AFX_STUDENT_CODE_PREFIX));
  return line ? line.replace(AFX_STUDENT_CODE_PREFIX, "").trim() : null;
}

// ── L16 → AFX-Desk 전송 데이터 타입 ─────────────────

export interface L16ToAfxExamResult {
  studentCode: string;          // L16 학생코드 = AFX notes 키
  examName: string;
  score: number;
  date: string;                 // ISO YYYY-MM-DD
  wrongCount: number;
  weakTypes: string[];          // 취약 유형 (수능 문항 유형)
  reflectionSummary: string;    // 회고 요약
  source: "l16";
}

export interface L16ToAfxAssignmentEvent {
  eventId: string;              // Supabase row id (멱등키)
  studentCode: string;
  typeId: string;
  typeName: string;
  score: number | null;
  submittedAt: string;
  completed: boolean;
  source: "l16";
}

export interface L16ToAfxConsultation {
  studentCode: string;
  message: string;
  createdAt: string;
  adminReply: string;
  repliedAt: string | null;
  source: "l16";
}

export interface L16ToAfxLessonRecording {
  studentCode: string;
  recordedAt: string;
  durationSec: number;
  transcript: string;
  analysis: string;
  keywords: string[];
  source: "l16";
}

// ── AFX-Desk 웹훅 페이로드 ───────────────────────────
// AFX-Desk → L16 방향: SMS 승인, 보고서 확정 등

export interface AfxToL16SmsApproval {
  type: "sms_approved";
  studentCode: string;
  message: string;
  approvedAt: string;
  recipientPhone: string;
}

export interface AfxToL16ReportConfirmed {
  type: "report_confirmed";
  studentCode: string;
  reportMonth: string;          // "2026-08"
  content: string;
  confirmedAt: string;
}

// ── L16 결과 → AFX 학습기록 변환 ─────────────────────

import type { ExamResult } from "../core/types";

export function examResultToAfxRecord(r: ExamResult): L16ToAfxExamResult {
  const cnt: Record<string, number> = {};
  (r.wrongAnswers ?? []).forEach((w: any) =>
    (w.reasons ?? []).forEach((rs: string) => { cnt[rs] = (cnt[rs]||0)+1; })
  );
  const weakTypes = Object.entries(cnt)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

  const ref = r.reflection as any;
  const reflectionSummary = [
    ref?.hardestReason ? `어려웠던 점: ${ref.hardestReason}` : "",
    ref?.nextGoal ? `목표: ${ref.nextGoal}` : "",
  ].filter(Boolean).join(" / ");

  return {
    studentCode: r.student.studentCode,
    examName: r.exam.examName,
    score: r.score,
    date: r.date,
    wrongCount: (r.wrongAnswers ?? []).length,
    weakTypes,
    reflectionSummary,
    source: "l16",
  };
}

// ── AFX 웹훅 전송 (L16 → AFX) ────────────────────────

const AFX_WEBHOOK_URL = import.meta.env.VITE_AFX_WEBHOOK_URL as string | undefined;
const AFX_WEBHOOK_SECRET = import.meta.env.VITE_AFX_WEBHOOK_SECRET as string | undefined;

export async function sendToAfx(
  payload: L16ToAfxExamResult | L16ToAfxAssignmentEvent | L16ToAfxConsultation | L16ToAfxLessonRecording
): Promise<{ ok: boolean; error?: string }> {
  if (!AFX_WEBHOOK_URL || !AFX_WEBHOOK_SECRET) {
    console.warn("[L16→AFX] 웹훅 URL 또는 시크릿 미설정 — 전송 생략");
    return { ok: false, error: "AFX 웹훅 미설정" };
  }
  try {
    const res = await fetch(AFX_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-l16-webhook-secret": AFX_WEBHOOK_SECRET,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true };
  } catch(e) {
    console.error("[L16→AFX] 전송 실패:", e);
    return { ok: false, error: (e as Error).message };
  }
}

// ── 동기화 상태 로컬 추적 ─────────────────────────────

const SYNC_LOG_KEY = "l16.afx.syncLog";

interface SyncLogEntry {
  id: string;
  type: string;
  studentCode: string;
  sentAt: string;
  ok: boolean;
  error?: string;
}

export function logSync(entry: Omit<SyncLogEntry, "sentAt">): void {
  const log: SyncLogEntry[] = getSyncLog();
  log.unshift({ ...entry, sentAt: new Date().toISOString() });
  localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(log.slice(0, 200)));
}

export function getSyncLog(): SyncLogEntry[] {
  try { return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) ?? "[]"); }
  catch { return []; }
}

/**
 * scheduledSms.ts
 * 예약 문자 발송 — Supabase scheduled_sms 테이블 CRUD + 실행기
 */
import { createClient } from "@supabase/supabase-js";
import type { SmsProvider } from "./sms";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const sb = createClient(supabaseUrl, supabaseKey);

export interface ScheduledSms {
  id: string;
  created_by: string;       // 'admin' | student_code
  target_phone: string;
  target_name: string;
  message: string;
  scheduled_at: string;     // ISO
  sent_at: string | null;
  status: "pending" | "sent" | "failed" | "cancelled";
  error_message: string | null;
  created_at: string;
}

// ── CRUD ─────────────────────────────────────────────

export async function listScheduledSms(): Promise<ScheduledSms[]> {
  const { data, error } = await sb
    .from("scheduled_sms")
    .select("*")
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addScheduledSms(
  payload: Omit<ScheduledSms, "id" | "sent_at" | "status" | "error_message" | "created_at">
): Promise<ScheduledSms> {
  const { data, error } = await sb
    .from("scheduled_sms")
    .insert({ ...payload, status: "pending" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelScheduledSms(id: string): Promise<void> {
  const { error } = await sb
    .from("scheduled_sms")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw error;
}

export async function deleteScheduledSms(id: string): Promise<void> {
  const { error } = await sb.from("scheduled_sms").delete().eq("id", id);
  if (error) throw error;
}

// ── 실행기: 발송 시각이 지난 pending 항목 즉시 발송 ──────────────

export async function runScheduledSms(provider: SmsProvider): Promise<number> {
  const now = new Date().toISOString();
  const { data: due, error } = await sb
    .from("scheduled_sms")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now);

  if (error || !due || due.length === 0) return 0;

  // 수업 종료된 학생의 기존 예약 문자도 발송 직전에 차단한다.
  const { data: endedStudents, error: rosterError } = await sb
    .from("students")
    .select("student_code,name,phone,parent_phone")
    .eq("student_status", "withdrawn");
  if (rosterError) throw rosterError;
  const normalizePhone = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

  let sent = 0;
  for (const row of due as ScheduledSms[]) {
    const blocked = (endedStudents ?? []).some((student: any) => {
      if (row.created_by === student.student_code) return true;
      if (row.created_by !== "admin" || row.target_name !== student.name) return false;
      const targetPhone = normalizePhone(row.target_phone);
      return !!targetPhone && [student.phone, student.parent_phone].some((phone) => normalizePhone(phone) === targetPhone);
    });
    if (blocked) {
      await sb
        .from("scheduled_sms")
        .update({ status: "cancelled", error_message: "수업 종료 학생 알림 발송 차단" })
        .eq("id", row.id)
        .eq("status", "pending");
      continue;
    }
    try {
      await provider.send(row.target_phone, row.message);
      await sb
        .from("scheduled_sms")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } catch (e) {
      await sb
        .from("scheduled_sms")
        .update({ status: "failed", error_message: (e as Error).message })
        .eq("id", row.id);
    }
  }
  return sent;
}

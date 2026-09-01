// ════════════════════════════════════════════════════════
// L16 ↔ WW / CLINIC-WW 연동 유틸리티
// 작업 의뢰 데이터 구조 및 변환 함수
// ════════════════════════════════════════════════════════

import type { ExamResult } from "../core/types";
import type { RosterEntry } from "../core/roster";

// ── WW 작업 의뢰 타입 ──────────────────────────────────

export type WWOrderType =
  | "variation_mock"     // 모의고사 변형 문제 제작
  | "workbook"           // 워크북 제작
  | "prelim_exam"        // 예비 시험지 제작
  | "vocab_list"         // 어휘 목록 제작
  | "grammar_sheet"      // 어법 정리 시트
  | "full_set";          // 전체 세트 (시험 대비 풀패키지)

export type ClinicOrderType =
  | "deep_analysis"      // 심화 오답 분석
  | "prescription"       // 맞춤 처방
  | "monthly_report";    // 월간 상담 보고서

export interface WWOrder {
  orderId: string;
  orderType: WWOrderType;
  studentCode: string;
  studentName: string;
  school: string;
  grade: string;
  examDate: string;          // 영어 시험일
  examRange: string;         // 시험 범위
  weakPoints: string[];      // 취약 유형 (오답 분석 기반)
  targetScore: number;       // 목표 점수
  currentScore: number;      // 현재 평균 점수
  requestedAt: string;
  memo: string;
  status: "pending" | "in_progress" | "done";
}

export interface ClinicOrder {
  orderId: string;
  orderType: ClinicOrderType;
  studentCode: string;
  studentName: string;
  results: ExamResult[];     // 최근 모의고사 결과 전체
  wrongPatterns: WrongPattern[];
  reflections: ReflectionSummary[];
  requestedAt: string;
  status: "pending" | "in_progress" | "done";
}

export interface WrongPattern {
  questionType: string;      // 수능 유형 (빈칸추론, 순서 등)
  count: number;
  avgConfidence: number;
  repeatNos: number[];       // 반복 오답 문항 번호
}

export interface ReflectionSummary {
  date: string;
  score: number;
  hardestReason: string;
  nextGoal: string;
}

// ── WW 작업 의뢰 생성 ─────────────────────────────────

export function buildWWOrder(
  student: RosterEntry,
  examDate: string,
  examRange: string,
  results: ExamResult[],
  orderType: WWOrderType,
  memo = ""
): WWOrder {
  const sorted = [...results].sort((a, b) => a.date.localeCompare(b.date));
  const avg = sorted.length
    ? Math.round(sorted.reduce((s, r) => s + r.score, 0) / sorted.length)
    : 0;
  const latest = sorted[sorted.length - 1];
  const target = Math.min(100, avg + 10);

  // 오답 원인 집계
  const cnt: Record<string, number> = {};
  sorted.forEach(r =>
    (r.wrongAnswers ?? []).forEach((w: any) =>
      (w.reasons ?? []).forEach((rs: string) => { cnt[rs] = (cnt[rs] || 0) + 1; })
    )
  );
  const weakPoints = Object.entries(cnt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  return {
    orderId: `WW-${Date.now()}-${student.studentCode}`,
    orderType,
    studentCode: student.studentCode,
    studentName: student.name,
    school: student.school ?? "",
    grade: student.grade ?? "",
    examDate,
    examRange,
    weakPoints,
    targetScore: target,
    currentScore: avg,
    requestedAt: new Date().toISOString(),
    memo,
    status: "pending",
  };
}

// ── CLINIC-WW 분석 의뢰 생성 ──────────────────────────

export function buildClinicOrder(
  student: RosterEntry,
  results: ExamResult[],
  orderType: ClinicOrderType
): ClinicOrder {
  const sorted = [...results].sort((a, b) => a.date.localeCompare(b.date));

  // 수능 문항 유형별 오답 패턴
  const typeMap: Record<string, { count: number; confs: number[]; nos: number[] }> = {};
  sorted.forEach(r =>
    (r.questionDetails ?? []).forEach((d: any) => {
      const qno = d.questionNo;
      const type = getQType(qno);
      if (!typeMap[type]) typeMap[type] = { count: 0, confs: [], nos: [] };
      typeMap[type].count++;
      if (d.confidenceBefore != null) typeMap[type].confs.push(d.confidenceBefore);
      if (!typeMap[type].nos.includes(qno)) typeMap[type].nos.push(qno);
    })
  );
  const wrongPatterns: WrongPattern[] = Object.entries(typeMap)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([type, v]) => ({
      questionType: type,
      count: v.count,
      avgConfidence: v.confs.length
        ? Math.round(v.confs.reduce((s, c) => s + c, 0) / v.confs.length)
        : 0,
      repeatNos: v.nos,
    }));

  // 회고 요약
  const reflections: ReflectionSummary[] = sorted
    .filter(r => r.reflection)
    .map(r => ({
      date: r.date,
      score: r.score,
      hardestReason: (r.reflection as any)?.hardestReason ?? "",
      nextGoal: (r.reflection as any)?.nextGoal ?? "",
    }));

  return {
    orderId: `CLINIC-${Date.now()}-${student.studentCode}`,
    orderType,
    studentCode: student.studentCode,
    studentName: student.name,
    results: sorted,
    wrongPatterns,
    reflections,
    requestedAt: new Date().toISOString(),
    status: "pending",
  };
}

// ── 수능 유형 분류 ────────────────────────────────────

const QTYPE_MAP: Record<number, string> = {
  18:"글의 목적", 19:"심경·분위기", 20:"필자 주장", 21:"밑줄 함의",
  22:"요지", 23:"주제", 24:"제목", 25:"도표 이해", 26:"내용 일치",
  27:"내용 일치(안내)", 28:"어법 정확성", 29:"어휘 적절성",
  30:"빈칸 추론", 31:"빈칸 추론", 32:"빈칸 추론", 33:"빈칸 추론",
  34:"빈칸(연결)", 35:"무관한 문장", 36:"글의 순서", 37:"글의 순서",
  38:"문장 삽입", 39:"문장 삽입", 40:"요약문 완성",
  41:"장문 독해", 42:"장문 독해", 43:"장문 독해",
  44:"장문 독해", 45:"장문 독해",
};

function getQType(qno: number): string {
  return QTYPE_MAP[qno] ?? `${qno}번`;
}

// ── localStorage 의뢰 저장 ────────────────────────────

const WW_ORDERS_KEY = "l16.ww.orders";
const CLINIC_ORDERS_KEY = "l16.clinic.orders";

export function saveWWOrder(order: WWOrder): void {
  const orders: WWOrder[] = loadWWOrders();
  orders.unshift(order);
  localStorage.setItem(WW_ORDERS_KEY, JSON.stringify(orders.slice(0, 100)));
}

export function loadWWOrders(): WWOrder[] {
  try {
    return JSON.parse(localStorage.getItem(WW_ORDERS_KEY) ?? "[]");
  } catch { return []; }
}

export function saveClinicOrder(order: ClinicOrder): void {
  const orders: ClinicOrder[] = loadClinicOrders();
  orders.unshift(order);
  localStorage.setItem(CLINIC_ORDERS_KEY, JSON.stringify(orders.slice(0, 100)));
}

export function loadClinicOrders(): ClinicOrder[] {
  try {
    return JSON.parse(localStorage.getItem(CLINIC_ORDERS_KEY) ?? "[]");
  } catch { return []; }
}

export function updateOrderStatus(
  key: typeof WW_ORDERS_KEY | typeof CLINIC_ORDERS_KEY,
  orderId: string,
  status: "pending" | "in_progress" | "done"
): void {
  const orders = JSON.parse(localStorage.getItem(key) ?? "[]");
  const updated = orders.map((o: any) =>
    o.orderId === orderId ? { ...o, status } : o
  );
  localStorage.setItem(key, JSON.stringify(updated));
}

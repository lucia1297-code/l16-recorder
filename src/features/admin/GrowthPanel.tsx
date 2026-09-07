import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, BarChart2, Microscope, Mail, Pill, FileText, Calendar, AlertTriangle, Repeat, FileEdit, Bookmark, User, BookOpen, Send, CheckCircle, Pencil, Printer } from "lucide-react";
import type { ExamResult } from "../../core/types";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";
import { createAssignmentStore } from "../../lib/assignmentStoreFactory";
import { ANALYSIS_QUESTIONS } from "../../core/assignment";
import type { AssignmentSubmission } from "../../core/assignment";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface GrowthMessage {
  id: string;
  studentCode: string;
  studentName: string;
  content: string;
  createdAt: string;
  sentAt: string | null;
  adminEdited: boolean;
  type: "prescription" | "monthly_report"; // 주간처방 | 월간상담평가서
  reportMonth?: string; // "2026-08" 형식
}

const REASON_KO: Record<string, string> = {
  Vocabulary:"어휘", Grammar:"어법", Reading:"독해", Inference:"추론",
  Logic:"논리", Time:"시간부족", Careless:"실수", Guess:"찍음", DidntKnow:"모름", Other:"기타"
};
const REASON_COLOR: Record<string, string> = {
  Vocabulary:"#7c3aed", Grammar:"#2563eb", Reading:"#0891b2", Inference:"#059669",
  Logic:"#d97706", Time:"#dc2626", Careless:"#db2777", Guess:"#64748b", DidntKnow:"#374151", Other:"#94a3b8"
};

// ── 핵심 수정: Supabase JSONB는 이미 객체로 반환 → JSON.parse 불필요 ──
function parseJsonField(val: unknown): any {
  if (val === null || val === undefined) return null;
  if (typeof val === "object") return val;           // ← 이미 객체이면 그대로
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return null; }
  }
  return null;
}

async function fetchResults(): Promise<ExamResult[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/results?select=*&order=date.asc,submitted_at.asc`,
    { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) return [];
  const _rawRows = await res.json();
  const rows = Array.isArray(_rawRows) ? _rawRows : [];
  return rows.map((r: any) => ({
    id: r.id,
    student: {
      studentCode: r.student_code,
      name: r.name,
      school: r.school ?? "",
      grade: r.grade ?? "",
    },
    exam: {
      examName: r.exam_name ?? "",
      year: r.year ?? 0,
      month: r.month ?? 0,
      round: r.round ?? 0,
      totalQuestions: r.total_questions ?? 45,
      maxScore: r.max_score ?? 100,
    },
    teacher: r.teacher ?? "",
    date: r.date ?? r.submitted_at?.slice(0, 10) ?? "",
    score: Number(r.score ?? 0),
    // ← 핵심: parseJsonField 사용
    wrongAnswers: parseJsonField(r.wrong_answers) ?? [],
    reflection: parseJsonField(r.reflection) ?? {},
    questionDetails: parseJsonField(r.question_details) ?? [],
    submittedAt: r.submitted_at ?? "",
  }));
}

async function fetchAssignmentsWithAnalysis(): Promise<AssignmentSubmission[]> {
  try {
    const store = createAssignmentStore();
    const subs = await store.listSubmissions();
    return subs.filter(s => s.analysisData != null);
  } catch { return []; }
}

async function sendSMS(phone: string, message: string): Promise<void> {
  const apiKey = import.meta.env.VITE_SOLAPI_API_KEY as string;
  const apiSecret = import.meta.env.VITE_SOLAPI_API_SECRET as string;
  const sender = import.meta.env.VITE_SOLAPI_SENDER as string;
  const date = new Date().toISOString();
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(date + salt));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  let to = phone.replace(/[^0-9]/g, "");
  if (to.startsWith("82")) to = "0" + to.slice(2);
  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify({ message: { to, from: sender, text: message } }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
}

export default function GrowthPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignmentSubs, setAssignmentSubs] = useState<AssignmentSubmission[]>([]);
  const [selected, setSelected] = useState("");
  const [viewTab, setViewTab] = useState<"compare" | "analysis" | "message" | "summary8">("compare");
  const [summary8Map, setSummary8Map] = useState<Map<string,string>>(new Map());
  const mountedRef = useRef(true);
  const [messages, setMessages] = useState<GrowthMessage[]>([]);
  useEffect(() => {
    mountedRef.current = true;
    loadMsgsFromSupabase().then(sbMsgs => {
      if (sbMsgs.length > 0) {
        setMessages(sbMsgs);
        localStorage.setItem("l16.growthMessages", JSON.stringify(sbMsgs));
      } else {
        try {
          const saved = JSON.parse(localStorage.getItem("l16.growthMessages") || "[]");
          if (saved.length > 0) { setMessages(saved); syncMsgsToSupabase(saved).catch(()=>{}); }
        } catch(e) { console.warn('[GrowthPanel] 오류:', e); }
      }
    });
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reportModal, setReportModal] = useState<{code:string;name:string} | null>(null);
  const [reportMonth, setReportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    fetchResults().then(r => { setResults(r); setLoading(false); });
    fetchAssignmentsWithAnalysis().then(setAssignmentSubs);
  }, [rosterStore]);

  function saveMsgs(msgs: GrowthMessage[]) {
    setMessages(msgs);
    localStorage.setItem("l16.growthMessages", JSON.stringify(msgs));
    syncMsgsToSupabase(msgs).catch(e => console.warn("[MsgSync]", e));
  }

  async function syncMsgsToSupabase(msgs: GrowthMessage[]) {
    for (const m of msgs) {
      await fetch(`${SUPABASE_URL}/rest/v1/growth_messages`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          id: m.id, student_code: m.studentCode,
          student_name: m.studentName, content: m.content,
          created_at: m.createdAt, sent_at: m.sentAt ?? null,
          admin_edited: m.adminEdited,
          type: m.type ?? "prescription",
          report_month: m.reportMonth ?? "",
        }),
      }).catch(e => console.debug('[GrowthSync] 메시지 동기화 실패 (무시):', e?.message));
    }
  }

  async function loadMsgsFromSupabase(): Promise<GrowthMessage[]> {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/growth_messages?order=created_at.desc`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
      );
      if (!res.ok) return [];
      const _rawJson = await res.json();
    const rows = Array.isArray(_rawJson) ? _rawJson : [];
      if (!Array.isArray(rows) || rows.length === 0) return [];
      return rows.map((r: any): GrowthMessage => ({
        id: r.id, studentCode: r.student_code,
        studentName: r.student_name, content: r.content,
        createdAt: r.created_at, sentAt: r.sent_at ?? null,
        adminEdited: r.admin_edited ?? false,
        type: r.type ?? "prescription",
        reportMonth: r.report_month || undefined,
      }));
    } catch { return []; }
  }

  const byStudent = useMemo(() => {
    const map = new Map<string, ExamResult[]>();
    results.forEach(r => {
      const k = r.student.studentCode;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    });
    return map;
  }, [results]);

  function makeDiagnosis(code: string, name: string): string {
    const rows = byStudent.get(code) || [];
    if (!rows.length) return "";
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const recent3 = sorted.slice(-3);
    const latest = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    const avg = Math.round(recent3.reduce((s, r) => s + r.score, 0) / recent3.length);
    const trend = prev ? latest.score - prev.score : 0;
    const totalCnt: Record<string, number> = {};
    sorted.forEach(r => (r.wrongAnswers ?? []).forEach((w: any) =>
      (w.reasons || []).forEach((rs: string) => { totalCnt[rs] = (totalCnt[rs] || 0) + 1; })
    ));
    const top3 = Object.entries(totalCnt).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const ref = (latest.reflection as any) || {};
    const student = roster.find(r => r.studentCode === code);
    const school = student?.school ?? "";
    const grade = student?.grade ?? "";
    const now = new Date();
    const month = now.getMonth() + 1;

    // 등급 판정
    const grade_str = latest.score >= 90 ? "1등급권" : latest.score >= 80 ? "2등급권" :
      latest.score >= 70 ? "3등급권" : latest.score >= 60 ? "4등급권" : "5등급권 이하";
    const target_str = latest.score >= 90 ? "실전 완성도를 높이고 만점에 근접하는 것"
      : latest.score >= 80 ? "안정적인 1등급 진입"
      : latest.score >= 70 ? "2등급권 안착 및 고득점 기반 마련"
      : latest.score >= 60 ? "3등급권 진입 및 기초 독해력 강화"
      : "기초 어휘와 문장 구조 파악 능력 정비";

    // 오답 원인 전문 해석
    const diagMap: Record<string, string> = {
      Vocabulary: "어휘력 기반 독해 능력 부족으로, 지문의 핵심 단어를 파악하지 못해 문맥 이해에 어려움을 겪고 있습니다",
      Reading: "지문의 논리적 흐름과 핵심 주제 파악에 어려움이 있으며, 정보 처리 속도와 정확도 향상이 필요합니다",
      Inference: "추론형 문항에서의 실점이 두드러지며, 지문에 명시되지 않은 함의를 도출하는 논리적 사고 훈련이 필요합니다",
      Logic: "논리 전개 구조를 파악하는 능력이 아직 충분히 형성되지 않아, 글의 흐름을 놓치는 경향이 있습니다",
      Grammar: "어법 문항에서의 실점은 영문법 핵심 규칙에 대한 체계적 정리가 이루어지지 않은 것에 기인합니다",
      Time: "풀이 시간 배분 전략이 아직 확립되지 않아 후반부 문항에서 집중력이 저하되는 패턴이 나타납니다",
      Careless: "정답을 알고도 놓치는 부주의 실점이 반복되고 있으며, 이는 실전 훈련을 통한 검토 습관으로 개선 가능합니다",
      Guess: "자신감 부족으로 인한 무작위 선택이 빈번하여, 어휘와 독해 기반을 강화함으로써 확신도를 높여야 합니다",
      DidntKnow: "기본 개념과 어휘가 충분히 갖추어지지 않은 상태이며, 단계적인 기초 학습이 선행되어야 합니다",
    };

    // 처방 전문화
    const prescMap: Record<string, string> = {
      Vocabulary: "어휘 학습은 단순 암기에서 벗어나 문맥 속 의미 파악 훈련을 병행하고, 수능 빈출 어휘를 주제별로 체계화하여 학습하도록 지도하고 있습니다",
      Reading: "핵심어 중심의 단락별 요지 파악 훈련을 강화하고, 지문을 읽기 전 선지를 먼저 검토하는 전략적 독해 방식을 체화시키고 있습니다",
      Inference: "추론 문항은 지문 내 근거 문장을 먼저 확정한 후 선지를 대입하는 방식으로 오답을 제거하는 훈련을 집중적으로 진행하고 있습니다",
      Logic: "빈칸 및 순서 배열 문항에서 접속어와 지시어 중심으로 논리적 흐름을 추적하는 훈련을 강화하고 있습니다",
      Grammar: "어법 핵심 규칙 5개 유형(동사, 준동사, 관계사, 병렬, 수일치)을 반복 정리하고 기출 패턴 분석을 병행하고 있습니다",
      Time: "Step별 목표 시간을 설정하고 실전 모의 훈련을 통해 시간 내 풀이 패턴을 확립하도록 지도하고 있습니다",
      Careless: "풀이 후 30초 검토 습관을 형성하고, 특히 선지 혼동이 잦은 유형에서는 근거 문장을 반드시 확인하도록 훈련하고 있습니다",
      Guess: "어휘와 독해 기반을 강화하여 문항에 대한 확신도를 높이고, 소거법을 통한 전략적 접근을 훈련하고 있습니다",
      DidntKnow: "기초 문법과 필수 어휘를 단계적으로 보완하며, 단기간에 성과를 낼 수 있는 우선순위 학습 계획을 수립하여 진행 중입니다",
    };

    const top1Key = top3[0]?.[0] ?? "";
    const top2Key = top3[1]?.[0] ?? "";
    const top3Key = top3[2]?.[0] ?? "";
    const top1Diag = diagMap[top1Key] ?? "전반적인 영어 독해 능력 향상이 필요한 상황입니다";
    const top1Presc = prescMap[top1Key] ?? "기초부터 체계적으로 보완하는 방향으로 지도하고 있습니다";
    const top2Presc = top2Key ? prescMap[top2Key] ?? "" : "";

    const trendComment = trend > 3 ? `직전 시험 대비 ${trend}점 향상되는 긍정적인 흐름을 보이고 있으며` :
      trend < -3 ? `직전 시험 대비 ${Math.abs(trend)}점 하락하였으나, 이는 일시적인 편차로 판단되며` :
      "점수가 안정적으로 유지되고 있으며";

    const refComment = ref.hardestReason
      ? `학생 스스로는 "${ref.hardestReason}"을 가장 어려운 부분으로 인식하고 있으며`
      : "학생의 자가 진단 결과";
    const goalComment = ref.nextGoal
      ? `"${ref.nextGoal}"을 다음 목표로 설정하고 있습니다`
      : "명확한 목표 설정이 이루어지고 있습니다";

    return `${school} ${grade}학년 ${name} 학생 ${month}월 학습 상담 평가서

안녕하십니까, ${name} 학생 학부모님. ${month}월 한 달간 ${name} 학생의 학습 현황을 정리하여 말씀드립니다.

【현재 수준】
${name} 학생은 현재 ${grade_str}(최근 ${avg}점 평균)에 해당하며, ${trendComment} 전반적인 학습 기반이 갖추어지고 있는 상황입니다. 총 ${sorted.length}회의 모의고사 데이터를 바탕으로 분석한 결과, 꾸준한 응시 노력이 실력 형성에 긍정적으로 작용하고 있습니다.

【오답 원인 분석】
누적 오답 분석 결과, 가장 두드러진 취약 원인은 ${REASON_KO[top1Key] ?? top1Key}(으)로, ${top1Diag}. ${top2Key ? `또한 ${REASON_KO[top2Key] ?? top2Key} 영역에서도 개선이 요구되며, ` : ""}${top3Key ? `${REASON_KO[top3Key] ?? top3Key} 관련 실점도 함께 관리가 필요합니다.` : "이 부분에 대한 집중 지도가 진행 중입니다."}

【학생 자가 평가】
${refComment}, ${goalComment}. 이러한 자기 인식은 성장의 중요한 출발점이며, 강사로서 학생의 목표의식을 지속적으로 강화하는 방향으로 지도하고 있습니다.

【강사 진단 및 처방】
단기적으로는 ${top1Presc}. ${top2Presc ? `더불어, ${top2Presc}.` : ""} 이를 통해 오답 유형별 대응 전략을 체계화하고, 문항 유형에 따른 풀이 패턴을 확립하는 것이 이번 달의 핵심 목표입니다.

【미래 목표 및 로드맵】
중기적으로는 ${target_str}을 목표로 하고 있습니다. 수능까지 남은 기간을 고려할 때, 현재 취약 영역을 집중 보완하는 시기를 거쳐 실전 모의 훈련으로 전환하는 2단계 전략이 가장 효율적입니다. 현재 ${name} 학생의 학습 태도와 잠재력을 감안하면 목표 달성이 충분히 가능하다고 판단합니다.

이달도 ${name} 학생이 최선을 다해 임해주었습니다. 학습에 있어 가정에서의 꾸준한 격려와 관심이 학생에게 큰 힘이 됩니다. 궁금하신 사항이 있으시면 언제든지 연락 주십시오. 감사합니다.`;
  }

  function printReport(code: string) {
    const student = roster.find(r => r.studentCode === code);
    const rows = byStudent.get(code) ?? [];
    const sorted = [...rows].sort((a,b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length-1];
    const ref = (latest?.reflection as any) || {};
    const cnt: Record<string,number> = {};
    sorted.forEach(r => ((r.wrongAnswers??(r as any).wrong_answers)??[]).forEach((w:any) =>
      (w.reasons||[]).forEach((rs:string) => { cnt[rs]=(cnt[rs]||0)+1; })));
    const top3 = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([r])=>REASON_KO[r]??r);
    const avg = sorted.length ? Math.round(sorted.reduce((s,r)=>s+r.score,0)/sorted.length) : 0;
    const trend = sorted.length >= 2 ? sorted[sorted.length-1].score - sorted[sorted.length-2].score : 0;
    const month = new Date().getMonth()+1;

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${student?.name} 발전기록</title>
<style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Malgun Gothic", sans-serif; }
  body { padding: 0; color: #1e293b; }
  h1 { font-size: 22px; color: #0f766e; border-bottom: 3px solid #0f766e; padding-bottom: 8px; margin-bottom: 18px; }
  h2 { font-size: 14px; color: #0f766e; margin: 16px 0 8px; border-left: 4px solid #0f766e; padding-left: 8px; }
  .info { display: flex; gap: 20px; font-size: 12px; color: #64748b; margin-bottom: 18px; }
  .scores { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
  .score-chip { background: #f1f5f9; border-radius: 6px; padding: 4px 10px; font-size: 12px; }
  .score-chip.latest { background: #0f766e; color: #fff; font-weight: 700; }
  .reasons { display: flex; gap: 6px; flex-wrap: wrap; }
  .reason-chip { background: #fef3c7; color: #92400e; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 600; }
  .reflection { background: #f8fafc; border-radius: 8px; padding: 12px; font-size: 12px; line-height: 1.8; border: 1px solid #e2e8f0; }
  .section { margin-bottom: 16px; }
  .stat { font-size: 28px; font-weight: 700; color: #0f766e; }
  .trend { font-size: 14px; font-weight: 600; color: ${trend>=0?"#059669":"#ef4444"}; }
  .footer { margin-top: 24px; font-size: 11px; color: #94a3b8; text-align: right; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  @media print { button { display: none; } }
</style>
</head>
<body>
<h1>L16 개인 영어 지도 — ${month}월 발전기록</h1>
<div class="info">
  <span>학생: <strong>${student?.name}</strong></span>
  <span>학교: ${student?.school} ${student?.grade}학년</span>
  <span>제출 횟수: ${sorted.length}회</span>
  <span>출력일: ${new Date().toLocaleDateString("ko-KR")}</span>
</div>

<div class="section">
  <h2>📊 점수 추이</h2>
  <div style="margin-bottom:8px">
    <span class="stat">${latest?.score ?? "-"}점</span>
    <span class="trend" style="margin-left:10px">${trend>=0?"▲":"▼"}${Math.abs(trend)}점 변화 | 평균 ${avg}점</span>
  </div>
  <div class="scores">
    ${sorted.map((r,i)=>`<div class="score-chip ${i===sorted.length-1?"latest":""}">${r.date.slice(5)} ${r.score}점</div>`).join("")}
  </div>
</div>

<div class="section">
  <h2>⚠️ 주요 오답 원인</h2>
  <div class="reasons">
    ${Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([r,n])=>`<div class="reason-chip">${REASON_KO[r]??r} ${n}회</div>`).join("")}
  </div>
</div>

<div class="section">
  <h2>📝 최근 회고</h2>
  <div class="reflection">
    <div><strong>어려웠던 점:</strong> ${ref.hardestReason || "미작성"}</div>
    <div><strong>다음 목표:</strong> ${ref.nextGoal || "미작성"}</div>
    <div><strong>만족도:</strong> ${"★".repeat(ref.satisfaction||0)}${"☆".repeat(5-(ref.satisfaction||0))}</div>
  </div>
</div>

<div class="section">
  <h2>강사 처방</h2>
  <div class="reflection">
    ${top3.map(r=>`<div>• ${r} 집중 보완 필요</div>`).join("")}
    <div style="margin-top:8px;color:#0f766e;font-weight:600">목표: 다음 시험 ${(latest?.score??0)+5}점 이상</div>
  </div>
</div>

<div class="footer">L16 개인 영어 지도 | 담당강사 민수쌤</div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.onload = () => w.print();
  }

  function createMsg(code: string) {
    const student = roster.find(r => r.studentCode === code);
    if (!student) return;
    const content = makeDiagnosis(code, student.name);
    const msg: GrowthMessage = {
      id: Math.random().toString(36).slice(2),
      studentCode: code, studentName: student.name,
      content, createdAt: new Date().toISOString(),
      sentAt: null, adminEdited: false,
      type: "prescription",
    };
    saveMsgs([msg, ...messages]);
    setEditingId(msg.id); setEditText(content);
    setViewTab("message");
  }

  function createMonthlyReport(code: string, month: string) {
    const student = roster.find(r => r.studentCode === code);
    if (!student) return;
    // 이미 해당 월 보고서가 있으면 편집 모드로
    const existing = messages.find(m => m.studentCode === code && m.reportMonth === month && m.type === "monthly_report");
    if (existing) {
      setEditingId(existing.id);
      setEditText(existing.content);
      setViewTab("message");
      setReportModal(null);
      return;
    }
    const content = makeDiagnosis(code, student.name);
    const [y, mo] = month.split("-").map(Number);
    const monthLabel = `${y}년 ${mo}월`;
    const header = `━━━━━━━━━━━━━━━━━━━━━━━━━━
${monthLabel} 학습 상담 평가서
━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    const msg: GrowthMessage = {
      id: Math.random().toString(36).slice(2),
      studentCode: code, studentName: student.name,
      content: header + content,
      createdAt: new Date().toISOString(),
      sentAt: null, adminEdited: false,
      type: "monthly_report",
      reportMonth: month,
    };
    saveMsgs([msg, ...messages]);
    setEditingId(msg.id);
    setEditText(header + content);
    setViewTab("message");
    setReportModal(null);
  }

  async function sendMsg(msg: GrowthMessage) {
    if (!SUPABASE_URL || !SUPABASE_KEY) { setNotice("설정 오류"); return; }
    const s = roster.find(r => r.studentCode === msg.studentCode);
    const phone = s?.parentPhone || s?.phone;
    if (!phone) { setNotice("전화번호가 없습니다."); return; }
    setSending(msg.id);
    try {
      await sendSMS(phone as string, msg.content);
      saveMsgs(messages.map(m => m.id === msg.id ? { ...m, sentAt: new Date().toISOString() } : m));
      setNotice(`${msg.studentName} 발송 완료`);
      setTimeout(() => setNotice(""), 3000);
    } catch(e) { alert("발송 실패: " + (e as Error).message); }
    finally { setSending(null); }
  }

  function sendKakao(msg: GrowthMessage) {
    const s = roster.find(r => r.studentCode === msg.studentCode);
    const phone = s?.parentPhone || s?.phone;
    const text = encodeURIComponent(msg.content);
    // 카카오톡 공유 - 모바일에서 카카오 앱으로 이동
    const kakaoUrl = `kakaotalk://msg?type=text&text=${text}`;
    const fallback = `https://story.kakao.com/share?url=${encodeURIComponent(location.href)}&text=${text}`;
    if (!window.open(kakaoUrl, "_blank")) {
      // 데스크톱: 클립보드 복사 후 안내
      navigator.clipboard.writeText(msg.content).then(() => {
        alert(`카카오톡 메시지가 클립보드에 복사됐습니다.\n카카오톡을 열어 ${s?.name ?? ""} 학생 학부모님께 붙여넣기 하세요.`);
      });
    }
  }

  function sendEmail(msg: GrowthMessage) {
    const s = roster.find(r => r.studentCode === msg.studentCode);
    const subject = encodeURIComponent(`[L16] ${msg.studentName} 학생 ${new Date().getMonth()+1}월 학습 상담 평가서`);
    const body = encodeURIComponent(msg.content);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  }

  const active = roster.filter(r => (r.studentStatus ?? "active") !== "withdrawn");
  const displayStudents = selected
    ? Array.from(byStudent.entries()).filter(([code]) => code === selected)
    : Array.from(byStudent.entries()).sort(([a], [b]) => {
        const na = roster.find(r => r.studentCode === a)?.name ?? "";
        const nb = roster.find(r => r.studentCode === b)?.name ?? "";
        return na.localeCompare(nb);
      });

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <h2 style={{ margin:0, color:"#0f766e" }}>발전 기록</h2>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <select value={selected} onChange={e => setSelected(e.target.value)}
            style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
            <option value="">전체 학생</option>
            {active.map(r => <option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
          </select>
          <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2 }}>
            {([
              { key:"compare",  label:"비교 분석" },
              { key:"analysis", label:"정밀 분석" },
              { key:"message",  label:"처방 메시지" },
              { key:"summary8", label:"📋 상담요약 8줄" },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setViewTab(t.key)}
                style={{ padding:"5px 14px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, cursor:"pointer",
                  background: viewTab === t.key ? "#0f766e" : "transparent",
                  color: viewTab === t.key ? "#fff" : "#64748b" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {notice && <p style={{ color:"#0f766e", fontWeight:600, marginBottom:10 }}>{notice}</p>}

      {/* ══ 비교 분석 ══ */}
      {viewTab === "compare" && (
        <div>
          {loading ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>데이터 로딩 중…</p>
          ) : displayStudents.length === 0 ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>제출된 모의고사가 없습니다.</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
              {displayStudents.map(([code, rows]) => {
                const student = roster.find(r => r.studentCode === code);
                const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
                const latest = sorted[sorted.length-1];
                const prev = sorted[sorted.length-2];
                const trend = prev ? latest.score - prev.score : 0;

                // 오답 번호 집계
                const wrongNumCount: Record<number, number> = {};
                sorted.forEach(r => (r.wrongAnswers ?? []).forEach((w: any) => {
                  const n = w.questionNo;
                  if (n) wrongNumCount[n] = (wrongNumCount[n] || 0) + 1;
                }));
                const repeatWrong = Object.entries(wrongNumCount)
                  .filter(([, cnt]) => cnt >= 2)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 8);

                // 오답 원인 집계
                const reasonTotal: Record<string, number> = {};
                sorted.forEach(r => (r.wrongAnswers ?? []).forEach((w: any) =>
                  (w.reasons || []).forEach((rs: string) => { reasonTotal[rs] = (reasonTotal[rs] || 0) + 1; })
                ));
                const topReasons = Object.entries(reasonTotal).sort((a, b) => b[1] - a[1]).slice(0, 5);
                const totalWrong = Object.values(reasonTotal).reduce((s, n) => s + n, 0);

                return (
                  <div key={code} style={{ border:"1.5px solid #e2e8f0", borderRadius:14, overflow:"hidden" }}>
                    {/* 학생 헤더 */}
                    <div style={{ padding:"12px 16px", background:"#f0fdfa", borderBottom:"1px solid #e2e8f0",
                      display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                        <span style={{ fontWeight:700, fontSize:16, color:"#134e4a" }}>{student?.name ?? code}</span>
                        <span style={{ fontSize:12, color:"#64748b" }}>{student?.school} {student?.grade && `${student.grade}학년`}</span>
                        <span style={{ fontSize:15, fontWeight:700,
                          color: trend > 0 ? "#059669" : trend < 0 ? "#ef4444" : "#64748b" }}>
                          최근 {latest.score}점 {trend !== 0 ? (trend > 0 ? `▲${trend}` : `▼${Math.abs(trend)}`) : "→"}
                        </span>
                        <span style={{ fontSize:12, color:"#94a3b8" }}>총 {sorted.length}회</span>
                      </div>
                      <div style={{ display:"flex", gap:6 }}>
                        <button onClick={() => createMsg(code)}
                          style={{ padding:"6px 12px", borderRadius:8, border:"none", background:"#0f766e",
                            color:"#fff", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                          처방 생성
                        </button>
                        <button onClick={() => { setReportModal({code, name: roster.find(r=>r.studentCode===code)?.name ?? ""}); }}
                          style={{ padding:"6px 12px", borderRadius:8, border:"1.5px solid #0f766e", background:"#fff",
                            color:"#0f766e", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                          상담평가서
                        </button>
                      </div>
                    </div>

                    <div style={{ padding:"14px 16px" }}>
                      {/* ① 점수 추이 */}
                      <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>점수 추이</p>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"flex-end", marginBottom:16 }}>
                        {sorted.map((r, i) => {
                          const prev2 = sorted[i-1];
                          const diff = prev2 ? r.score - prev2.score : 0;
                          return (
                            <div key={i} style={{ textAlign:"center", minWidth:58 }}>
                              {diff !== 0 && i > 0 && (
                                <div style={{ fontSize:10, fontWeight:700, marginBottom:2,
                                  color: diff > 0 ? "#059669" : "#ef4444" }}>
                                  {diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`}
                                </div>
                              )}
                              <div style={{ padding:"6px 8px", borderRadius:10,
                                background: r === latest ? "#0f766e" : "#f1f5f9",
                                color: r === latest ? "#fff" : "#374151",
                                border: `2px solid ${r === latest ? "#0f766e" : "#e2e8f0"}` }}>
                                <div style={{ fontSize:10, marginBottom:2,
                                  color: r === latest ? "#99f6e4" : "#94a3b8" }}>
                                  {r.date.slice(5).replace("-", "/")}
                                </div>
                                <div style={{ fontSize:18, fontWeight:700 }}>{r.score}</div>
                                <div style={{ fontSize:9, color: r === latest ? "#99f6e4" : "#94a3b8",
                                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:54 }}>
                                  {r.exam.examName.slice(0, 5)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
                        {/* ② 오답 원인 */}
                        <div>
                          <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>
                            오답 원인 누적
                          </p>
                          {topReasons.length === 0 ? (
                            <p style={{ fontSize:12, color:"#94a3b8" }}>오답 데이터 없음</p>
                          ) : (
                            <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                              {topReasons.map(([rs, cnt]) => {
                                const pct = totalWrong > 0 ? Math.round(cnt / totalWrong * 100) : 0;
                                const color = REASON_COLOR[rs] ?? "#94a3b8";
                                return (
                                  <div key={rs}>
                                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                      <span style={{ fontSize:12, fontWeight:600, color }}>{REASON_KO[rs] ?? rs}</span>
                                      <span style={{ fontSize:11, color:"#94a3b8" }}>{cnt}회 ({pct}%)</span>
                                    </div>
                                    <div style={{ background:"#f1f5f9", borderRadius:4, height:8 }}>
                                      <div style={{ width:`${pct}%`, background:color, height:8, borderRadius:4, minWidth:4 }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* ③ 반복 오답 문항 */}
                        <div>
                          <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>
                            반복 오답 문항 (2회↑)
                          </p>
                          {repeatWrong.length === 0 ? (
                            <p style={{ fontSize:12, color:"#94a3b8" }}>반복 오답 없음 </p>
                          ) : (
                            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                              {repeatWrong.map(([num, cnt]) => (
                                <div key={num} style={{ padding:"5px 10px", borderRadius:8, textAlign:"center",
                                  background: Number(cnt) >= 3 ? "#fef2f2" : "#fff7ed",
                                  border: `1.5px solid ${Number(cnt) >= 3 ? "#fca5a5" : "#fdba74"}` }}>
                                  <div style={{ fontSize:16, fontWeight:700,
                                    color: Number(cnt) >= 3 ? "#dc2626" : "#c2410c" }}>{num}번</div>
                                  <div style={{ fontSize:10, color:"#94a3b8" }}>{cnt}회</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ④ 회고 이력 비교 테이블 */}
                      <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>회고 이력 비교</p>
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ borderCollapse:"collapse", width:"100%", fontSize:12, minWidth:600, tableLayout:"fixed" }}>
                          <thead>
                            <tr style={{ background:"#f8fafc" }}>
                              {[
                                { label:"날짜",       w:"68px"  },
                                { label:"점수",       w:"44px"  },
                                { label:"어려웠던 점", w:"18%"   },
                                { label:"다음 목표",   w:"18%"   },
                                { label:"만족도",     w:"56px"  },
                                { label:"틀린 문항",   w:"30%"   },
                              ].map(({ label: h, w }) => (
                                <th key={h} style={{ padding:"7px 8px",
                                  textAlign: h === "점수" || h === "만족도" ? "center" : "left",
                                  borderBottom:"1.5px solid #e2e8f0", color:"#64748b", fontWeight:600,
                                  fontSize:11, width:w, whiteSpace:"nowrap" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sorted.map((r, i) => {
                              const ref = (r.reflection as any) || {};
                              const wrongNums = (r.wrongAnswers ?? [])
                                .map((w: any) => w.questionNo)
                                .filter(Boolean)
                                .sort((a: number, b: number) => a - b);
                              const isLatest = i === sorted.length - 1;
                              return (
                                <tr key={i} style={{ background: isLatest ? "#f0fdfa" : i % 2 === 0 ? "#fff" : "#f9f9f9",
                                  borderBottom:"1px solid #f1f5f9" }}>
                                  <td style={{ padding:"6px 8px", color:"#475569", whiteSpace:"nowrap", verticalAlign:"top" }}>
                                    {r.date.slice(5)}
                                    {isLatest && <span style={{ marginLeft:4, fontSize:9, color:"#0f766e", fontWeight:700,
                                      background:"#d1fae5", padding:"1px 5px", borderRadius:4 }}>최근</span>}
                                  </td>
                                  <td style={{ padding:"6px 8px", textAlign:"center", fontWeight:700, verticalAlign:"top",
                                    color: r.score >= 90 ? "#059669" : r.score >= 70 ? "#2563eb" : "#ef4444" }}>
                                    {r.score}
                                  </td>
                                  <td style={{ padding:"8px 10px", color: ref.hardestReason ? "#374151" : "#cbd5e1",
                                    maxWidth:180, lineHeight:1.6, wordBreak:"break-all", whiteSpace:"normal", verticalAlign:"top" }}>
                                    {ref.hardestReason || "미작성"}
                                  </td>
                                  <td style={{ padding:"8px 10px", color: ref.nextGoal ? "#374151" : "#cbd5e1",
                                    maxWidth:180, lineHeight:1.6, wordBreak:"break-all", whiteSpace:"normal", verticalAlign:"top" }}>
                                    {ref.nextGoal || "미작성"}
                                  </td>
                                  <td style={{ padding:"6px 8px", textAlign:"center", fontSize:12, whiteSpace:"nowrap" }}>
                                    {ref.satisfaction
                                      ? <span title={`${ref.satisfaction}점`}>{"★".repeat(Number(ref.satisfaction))}{"☆".repeat(5 - Number(ref.satisfaction))}</span>
                                      : <span style={{ color:"#cbd5e1" }}>-</span>}
                                  </td>
                                  <td style={{ padding:"6px 8px", verticalAlign:"top" }}>
                                    <div style={{ display:"flex", flexWrap:"wrap", gap:2, maxWidth:"100%" }}>
                                      {wrongNums.map((n: number) => {
                                        const rep = (wrongNumCount[n] || 0) >= 2;
                                        return (
                                          <span key={n} style={{ fontSize:10, padding:"1px 4px", borderRadius:4,
                                            background: rep ? "#fef2f2" : "#f1f5f9",
                                            color: rep ? "#dc2626" : "#64748b",
                                            fontWeight: rep ? 700 : 400,
                                            border: `1px solid ${rep ? "#fca5a5" : "#e2e8f0"}`,
                                            whiteSpace:"nowrap" }}>
                                            {n}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p style={{ fontSize:10, color:"#94a3b8", marginTop:4 }}>
                        * 빨간 문항 = 반복 오답(2회↑) &nbsp;|&nbsp; 초록 행 = 최근 제출
                      </p>

                      {/* ⑤ 정밀조사 (3문항 상세) */}
                      {sorted.some(r => (r.questionDetails ?? []).length > 0) && (
                        <div style={{ marginTop:16 }}>
                          <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:10 }}>
                            🔬 3문항 정밀조사 이력
                          </p>
                          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                            {sorted.filter(r => (r.questionDetails ?? []).length > 0).map((r, ri) => (
                              <div key={ri} style={{ border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
                                <div style={{ padding:"7px 12px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0",
                                  display:"flex", gap:10, alignItems:"center" }}>
                                  <span style={{ fontSize:12, fontWeight:700, color:"#1e293b" }}>{r.date.slice(5)}</span>
                                  <span style={{ fontSize:12, fontWeight:700,
                                    color: r.score >= 90 ? "#059669" : r.score >= 70 ? "#2563eb" : "#ef4444" }}>
                                    {r.score}점
                                  </span>
                                  <span style={{ fontSize:11, color:"#64748b" }}>{r.exam.examName}</span>
                                </div>
                                <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:8 }}>
                                  {(r.questionDetails ?? []).map((d: any, di: number) => (
                                    <div key={di} style={{ padding:"10px 12px", background:"#f9fafb",
                                      borderRadius:8, border:"1px solid #f1f5f9" }}>
                                      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8, flexWrap:"wrap" }}>
                                        <span style={{ fontWeight:700, fontSize:14, color:"#7c3aed",
                                          background:"#ede9fe", padding:"2px 10px", borderRadius:8 }}>
                                          {d.questionNo}번
                                        </span>
                                        {d.chosenOption && (
                                          <span style={{ fontSize:12, color:"#ef4444", fontWeight:600 }}>
                                            선택: {d.chosenOption}번
                                          </span>
                                        )}
                                        {d.confidenceBefore !== undefined && (
                                          <span style={{ fontSize:12, color:"#64748b" }}>
                                            확신도: {d.confidenceBefore}%
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"6px 12px", fontSize:12 }}>
                                        {d.reasonStudent && (
                                          <div>
                                            <span style={{ color:"#94a3b8", fontWeight:600 }}>선택 이유: </span>
                                            <span style={{ color:"#374151" }}>{d.reasonStudent}</span>
                                          </div>
                                        )}
                                        {d.missedSignal && (
                                          <div>
                                            <span style={{ color:"#94a3b8", fontWeight:600 }}>놓친 신호: </span>
                                            <span style={{ color:"#ef4444" }}>{d.missedSignal}</span>
                                          </div>
                                        )}
                                        {d.evidenceSentence && (
                                          <div style={{ gridColumn:"1/-1" }}>
                                            <span style={{ color:"#94a3b8", fontWeight:600 }}>근거 문장: </span>
                                            <span style={{ color:"#374151" }}>{d.evidenceSentence}</span>
                                          </div>
                                        )}
                                        {d.studentNextAction && (
                                          <div style={{ gridColumn:"1/-1" }}>
                                            <span style={{ color:"#94a3b8", fontWeight:600 }}>다음 행동: </span>
                                            <span style={{ color:"#059669", fontWeight:600 }}>{d.studentNextAction}</span>
                                          </div>
                                        )}
                                        {d.optionElimination && Object.values(d.optionElimination).some((v: any) => v) && (
                                          <div style={{ gridColumn:"1/-1" }}>
                                            <span style={{ color:"#94a3b8", fontWeight:600 }}>선지 분석: </span>
                                            {Object.entries(d.optionElimination).filter(([,v]) => v).map(([k,v]) => (
                                              <span key={k} style={{ fontSize:11, marginLeft:6,
                                                background:"#f1f5f9", padding:"1px 6px", borderRadius:4, color:"#475569" }}>
                                                ①②③④⑤"[k]": {String(v)}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}


      {/* ══ 정밀 분석 탭 ══════════════════════════════ */}
      {viewTab === "analysis" && (
        <AnalysisView
          results={results.filter(r => !selected || r.student.studentCode === selected)}
          roster={roster}
          byStudent={byStudent}
          selected={selected}
          assignmentSubs={assignmentSubs.filter(s => !selected || s.studentCode === selected)}
        />
      )}

      {/* ══ 처방 메시지 ══ */}
      {viewTab === "summary8" && (
        <Summary8Panel
          roster={active.filter(r => (r.studentStatus ?? "active") !== "withdrawn")}
          results={results}
          assignmentSubs={assignmentSubs}
          summary8Map={summary8Map}
          setSummary8Map={setSummary8Map}
        />
      )}
      {viewTab === "message" && (
        <div>
          {messages.filter(m => !selected || m.studentCode === selected).length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
              <p style={{ fontSize:32, marginBottom:8 }}></p>
              <p>비교 분석 탭 → 학생 카드 → "처방 생성" 버튼을 눌러주세요.</p>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {messages.filter(m => !selected || m.studentCode === selected).map(msg => (
                <div key={msg.id} style={{ border:`1.5px solid ${msg.sentAt ? "#d1fae5" : "#e2e8f0"}`,
                  borderRadius:12, overflow:"hidden", background: msg.sentAt ? "#f0fdf4" : "#fff" }}>
                  <div style={{ padding:"10px 14px", background: msg.sentAt ? "#d1fae5" : "#f8fafc",
                    borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between",
                    alignItems:"center", flexWrap:"wrap", gap:8 }}>
                    <div>
                      <span style={{ fontWeight:700, fontSize:13 }}>{msg.studentName}</span>
                      <span style={{ fontSize:11, color:"#94a3b8", marginLeft:8 }}>
                        {new Date(msg.createdAt).toLocaleDateString("ko-KR")}
                      </span>
                      {msg.sentAt && <span style={{ fontSize:11, color:"#059669", marginLeft:8, fontWeight:600 }}>
                        발송 {new Date(msg.sentAt).toLocaleDateString("ko-KR")}
                      </span>}
                      {msg.adminEdited && <span style={{ fontSize:11, color:"#7c3aed", marginLeft:6 }}>수정됨</span>}
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      {editingId === msg.id ? (
                        <>
                          <button onClick={() => {
                            saveMsgs(messages.map(m => m.id === msg.id ? { ...m, content: editText, adminEdited: true } : m));
                            setEditingId(null);
                          }} style={{ padding:"4px 10px", borderRadius:6, border:"none", background:"#0f766e", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:600 }}>저장</button>
                          <button onClick={() => setEditingId(null)}
                            style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #e2e8f0", background:"#fff", fontSize:12, cursor:"pointer" }}>취소</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditingId(msg.id); setEditText(msg.content); }}
                            style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #e2e8f0", background:"#fff", fontSize:12, cursor:"pointer" }}>수정</button>
                          <button onClick={() => sendMsg(msg)} disabled={sending === msg.id}
                            style={{ padding:"4px 10px", borderRadius:6, border:"none",
                              background: msg.sentAt ? "#f1f5f9" : "#0f766e",
                              color: msg.sentAt ? "#64748b" : "#fff", fontSize:12, cursor:"pointer", fontWeight:600 }}>
                            {sending === msg.id ? "발송 중…" : msg.sentAt ? "재발송" : "발송"}
                          </button>
                          <button onClick={() => { if (!confirm("삭제?")) return; saveMsgs(messages.filter(m => m.id !== msg.id)); }}
                            style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #fca5a5", background:"#fff", fontSize:12, cursor:"pointer", color:"#ef4444" }}>삭제</button>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ padding:"12px 14px" }}>
                    {editingId === msg.id ? (
                      <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={12}
                        style={{ width:"100%", padding:"10px", borderRadius:8, border:"1px solid #7c3aed",
                          fontSize:13, resize:"vertical", boxSizing:"border-box", fontFamily:"monospace", lineHeight:1.6 }} />
                    ) : (
                      <pre style={{ margin:0, fontSize:12, color:"#374151", whiteSpace:"pre-wrap", fontFamily:"inherit", lineHeight:1.6 }}>
                        {msg.content}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 상담평가서 작성 모달 ── */}
      {reportModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:400,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:14, padding:24, width:"100%", maxWidth:400,
            boxShadow:"0 8px 40px rgba(0,0,0,0.2)" }}>
            <h3 style={{ margin:"0 0 16px", color:"#0f766e" }}>상담평가서 작성</h3>
            <p style={{ fontSize:13, color:"#475569", marginBottom:16 }}>
              <strong>{reportModal.name}</strong> 학생의 상담평가서를 작성합니다.
            </p>

            {/* 월 선택 */}
            <label style={{ fontSize:13, fontWeight:600, display:"block", marginBottom:6 }}>대상 월</label>
            <input type="month" value={reportMonth}
              onChange={e => setReportMonth(e.target.value)}
              style={{ width:"100%", padding:"9px 12px", borderRadius:8,
                border:"1.5px solid #0f766e", fontSize:14, marginBottom:12, boxSizing:"border-box" as const }} />

            {/* 이미 작성된 월 표시 */}
            {messages.filter(m => m.studentCode === reportModal.code && m.type === "monthly_report").length > 0 && (
              <div style={{ marginBottom:14, padding:"8px 12px", background:"#f0fdf4", borderRadius:8,
                border:"1px solid #a7f3d0" }}>
                <p style={{ fontSize:11, color:"#059669", fontWeight:600, marginBottom:4 }}>작성된 평가서</p>
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                  {messages
                    .filter(m => m.studentCode === reportModal.code && m.type === "monthly_report")
                    .sort((a,b) => (b.reportMonth||"").localeCompare(a.reportMonth||""))
                    .map(m => (
                      <span key={m.id} style={{ fontSize:11, padding:"2px 8px", borderRadius:6,
                        background: m.sentAt ? "#0f766e" : "#e2e8f0",
                        color: m.sentAt ? "#fff" : "#475569", fontWeight:600 }}>
                        {m.reportMonth?.replace("-","년 ")}월{m.sentAt?" ✅":""}
                      </span>
                    ))}
                </div>
              </div>
            )}

            <p style={{ fontSize:12, color:"#94a3b8", marginBottom:16 }}>
              ※ 매월 10일경 학부모님께 발송 권장
            </p>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => createMonthlyReport(reportModal.code, reportMonth)}
                style={{ flex:1, padding:11, borderRadius:8, border:"none", background:"#0f766e",
                  color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                작성 시작
              </button>
              <button onClick={() => setReportModal(null)}
                style={{ flex:1, padding:11, borderRadius:8, border:"1px solid #e2e8f0",
                  background:"#fff", fontSize:14, cursor:"pointer" }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ④ 과제 정밀 분석 섹션 */}
      {assignmentSubs.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", marginBottom:12 }}>
            과제 정밀 분석 이력
          </h3>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {(() => {
              // 학생별로 그룹화
              const byStudentMap = new Map<string, AssignmentSubmission[]>();
              assignmentSubs.forEach(s => {
                if (!byStudentMap.has(s.studentCode)) byStudentMap.set(s.studentCode, []);
                byStudentMap.get(s.studentCode)!.push(s);
              });
              return Array.from(byStudentMap.entries()).map(([code, subs]) => {
                const studentName = roster.find(r=>r.studentCode===code)?.name ?? code;
                return (
                  <div key={code} style={{ border:"1.5px solid #e2e8f0", borderRadius:12, overflow:"hidden" }}>
                    <div style={{ padding:"10px 14px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
                      <span style={{ fontWeight:700, fontSize:14 }}>{studentName}</span>
                      <span style={{ fontSize:11, color:"#94a3b8", marginLeft:8 }}>과제 분석 {subs.length}건</span>
                    </div>
                    <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:12 }}>
                      {subs.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)).map((sub, si) => {
                        const cat = sub.analysisData!.category;
                        const catLabel = cat==="vocabulary"?"어휘":cat==="grammar"?"어법":
                          cat==="essay"?"서술형":cat==="mockexam"?"모의고사":"독해";
                        const catColor = cat==="vocabulary"?"#7c3aed":cat==="grammar"?"#2563eb":
                          cat==="essay"?"#db2777":cat==="mockexam"?"#dc2626":"#0891b2";
                        const catBg = cat==="vocabulary"?"#ede9fe":cat==="grammar"?"#dbeafe":
                          cat==="essay"?"#fce7f3":cat==="mockexam"?"#fee2e2":"#cffafe";
                        const questions = ANALYSIS_QUESTIONS[cat];
                        return (
                          <div key={si} style={{ border:"1px solid #f1f5f9", borderRadius:8, overflow:"hidden" }}>
                            <div style={{ padding:"7px 12px", background:catBg,
                              display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                              <span style={{ fontSize:12, fontWeight:700, color:catColor,
                                background:"#fff", padding:"2px 8px", borderRadius:6 }}>
                                {catLabel}
                              </span>
                              <span style={{ fontSize:11, color:"#64748b" }}>
                                {sub.submittedAt.slice(0,10)}
                              </span>
                              {sub.score != null && (
                                <span style={{ fontSize:11, fontWeight:700,
                                  color: sub.score>=90?"#059669":sub.score>=70?"#2563eb":"#ef4444" }}>
                                  {sub.score}점
                                </span>
                              )}
                            </div>
                            <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:8 }}>
                              {sub.analysisData!.answers.map((ans, ai) => {
                                const q = questions.find(q=>q.id===ans.questionId);
                                if (!q) return null;
                                return (
                                  <div key={ai} style={{ fontSize:12 }}>
                                    <span style={{ color:"#94a3b8", fontWeight:600 }}>Q. {q.question} </span>
                                    {ans.rating && (
                                      <span style={{ color:ans.rating>=4?"#059669":ans.rating>=3?"#d97706":"#dc2626",
                                        fontWeight:700 }}>
                                        {"😟😕😐😊😄"[ans.rating-1]}
                                        {" "+["많이 어려워요","조금 어려워요","보통이에요","잘 됐어요","완벽해요"][ans.rating-1]}
                                      </span>
                                    )}
                                    {ans.text && <span style={{ color:"#374151" }}>→ {ans.text}</span>}
                                    {ans.choice && (
                                      <span style={{ background:catBg, color:catColor,
                                        padding:"1px 7px", borderRadius:6, fontWeight:600, marginLeft:4 }}>
                                        {ans.choice}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// 정밀 분석 뷰 컴포넌트
// ════════════════════════════════════════════════════════
const QUESTION_TYPE_MAP: Record<number, { type: string; color: string; bg: string }> = {
  18: { type:"글의 목적", color:"#7c3aed", bg:"#ede9fe" },
  19: { type:"심경·분위기", color:"#db2777", bg:"#fce7f3" },
  20: { type:"필자 주장", color:"#dc2626", bg:"#fee2e2" },
  21: { type:"밑줄 함의", color:"#d97706", bg:"#fef3c7" },
  22: { type:"요지", color:"#059669", bg:"#d1fae5" },
  23: { type:"주제", color:"#0891b2", bg:"#cffafe" },
  24: { type:"제목", color:"#2563eb", bg:"#dbeafe" },
  25: { type:"도표 이해", color:"#64748b", bg:"#f1f5f9" },
  26: { type:"내용 일치", color:"#374151", bg:"#f3f4f6" },
  27: { type:"내용 일치(안내)", color:"#374151", bg:"#f3f4f6" },
  28: { type:"어법 정확성", color:"#7c3aed", bg:"#ede9fe" },
  29: { type:"어휘 적절성", color:"#db2777", bg:"#fce7f3" },
  30: { type:"빈칸 추론", color:"#dc2626", bg:"#fee2e2" },
  31: { type:"빈칸 추론", color:"#dc2626", bg:"#fee2e2" },
  32: { type:"빈칸 추론", color:"#dc2626", bg:"#fee2e2" },
  33: { type:"빈칸 추론", color:"#dc2626", bg:"#fee2e2" },
  34: { type:"빈칸 추론(연결)", color:"#d97706", bg:"#fef3c7" },
  35: { type:"무관한 문장", color:"#0891b2", bg:"#cffafe" },
  36: { type:"글의 순서", color:"#059669", bg:"#d1fae5" },
  37: { type:"글의 순서", color:"#059669", bg:"#d1fae5" },
  38: { type:"문장 삽입", color:"#2563eb", bg:"#dbeafe" },
  39: { type:"문장 삽입", color:"#2563eb", bg:"#dbeafe" },
  40: { type:"요약문 완성", color:"#7c3aed", bg:"#ede9fe" },
  41: { type:"장문 독해(목적)", color:"#64748b", bg:"#f1f5f9" },
  42: { type:"장문 독해(어휘)", color:"#64748b", bg:"#f1f5f9" },
  43: { type:"장문 독해(내용)", color:"#374151", bg:"#f3f4f6" },
  44: { type:"장문 독해(순서)", color:"#374151", bg:"#f3f4f6" },
  45: { type:"장문 독해(삽입)", color:"#374151", bg:"#f3f4f6" },
};

function getQType(n: number) {
  return QUESTION_TYPE_MAP[n] ?? { type:`${n}번`, color:"#64748b", bg:"#f1f5f9" };
}

interface AnalysisProps {
  results: ExamResult[];
  roster: RosterEntry[];
  byStudent: Map<string, ExamResult[]>;
  selected: string;
  assignmentSubs: AssignmentSubmission[];
}

function AnalysisView({ results, roster, byStudent, selected, assignmentSubs }: AnalysisProps) {
  const [detailStudent, setDetailStudent] = useState<string | null>(null);

  // 전체 정밀조사 데이터 수집
  const allDetails = useMemo(() => {
    const list: Array<{
      studentCode: string; studentName: string; date: string;
      examName: string; score: number;
      detail: import("../../core/types").QuestionDetail;
    }> = [];
    results.forEach(r => {
      (r.questionDetails ?? []).forEach(d => {
        list.push({
          studentCode: r.student.studentCode,
          studentName: r.student.name,
          date: r.date,
          examName: r.exam.examName,
          score: r.score,
          detail: d,
        });
      });
    });
    return list;
  }, [results]);

  // 유형별 집계
  const byType = useMemo(() => {
    const map = new Map<string, typeof allDetails>();
    allDetails.forEach(item => {
      const t = getQType(item.detail.questionNo).type;
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(item);
    });
    return map;
  }, [allDetails]);

  // 학생별 정밀조사 이력
  const byStudentDetails = useMemo(() => {
    const map = new Map<string, typeof allDetails>();
    allDetails.forEach(item => {
      if (!map.has(item.studentCode)) map.set(item.studentCode, []);
      map.get(item.studentCode)!.push(item);
    });
    return map;
  }, [allDetails]);

  // 반복 오답 문항 (전체 오답 기준)
  const repeatMap = useMemo(() => {
    const cnt: Record<string, Record<number, number>> = {};
    results.forEach(r => {
      const code = r.student.studentCode;
      if (!cnt[code]) cnt[code] = {};
      (r.wrongAnswers ?? []).forEach((w: any) => {
        cnt[code][w.questionNo] = (cnt[code][w.questionNo] || 0) + 1;
      });
    });
    return cnt;
  }, [results]);

  const activeStudents = [...new Set(results.map(r => r.student.studentCode))];

  if (allDetails.length === 0) {
    return (
      <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
        <p style={{ fontSize:32, marginBottom:8 }}>🔬</p>
        <p style={{ fontSize:14, fontWeight:600 }}>정밀조사 데이터가 없습니다.</p>
        <p style={{ fontSize:12, marginTop:6 }}>
          학생이 모의고사 제출 시 8단계(상세분석)에서 입력한 내용이 여기 표시됩니다.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ① 유형별 취약점 분포 */}
      <div style={{ marginBottom:24 }}>
        <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", marginBottom:12 }}>
          유형별 취약점 분포
        </h3>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {Array.from(byType.entries())
            .sort((a, b) => b[1].length - a[1].length)
            .map(([type, items]) => {
              const sample = getQType(items[0].detail.questionNo);
              const lowConf = items.filter(i => i.detail.confidenceBefore < 50).length;
              return (
                <div key={type} style={{ border:`1.5px solid ${sample.color}30`,
                  borderRadius:10, padding:"10px 14px", minWidth:140,
                  background: sample.bg, cursor:"pointer" }}>
                  <div style={{ fontSize:11, fontWeight:700, color:sample.color, marginBottom:4 }}>{type}</div>
                  <div style={{ fontSize:20, fontWeight:700, color:sample.color }}>{items.length}회</div>
                  <div style={{ fontSize:10, color:"#94a3b8", marginTop:2 }}>
                    저자신감 {lowConf}회 · {[...new Set(items.map(i=>i.studentName))].length}명
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* ② 학생별 정밀조사 이력 */}
      <div style={{ marginBottom:24 }}>
        <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", marginBottom:12 }}>
          학생별 정밀조사 이력
        </h3>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {activeStudents
            .filter(code => !selected || code === selected)
            .map(code => {
              const studentName = roster.find(r => r.studentCode === code)?.name ?? code;
              const items = byStudentDetails.get(code) ?? [];
              const rmap = repeatMap[code] ?? {};
              const isOpen = detailStudent === code;
              if (items.length === 0) return null;

              // 이 학생의 유형별 집계
              const typeCnt: Record<string, number> = {};
              items.forEach(i => {
                const t = getQType(i.detail.questionNo).type;
                typeCnt[t] = (typeCnt[t] || 0) + 1;
              });
              const topType = Object.entries(typeCnt).sort((a,b)=>b[1]-a[1])[0];

              return (
                <div key={code} style={{ border:"1.5px solid #e2e8f0", borderRadius:12, overflow:"hidden" }}>
                  {/* 학생 헤더 */}
                  <div style={{ padding:"10px 14px", background:"#f8fafc",
                    borderBottom: isOpen ? "1px solid #e2e8f0" : "none",
                    display:"flex", justifyContent:"space-between", alignItems:"center",
                    cursor:"pointer" }}
                    onClick={() => setDetailStudent(isOpen ? null : code)}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                      <span style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>{studentName}</span>
                      <span style={{ fontSize:11, color:"#94a3b8" }}>정밀조사 {items.length}건</span>
                      {topType && (
                        <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6,
                          background: getQType(items.find(i=>getQType(i.detail.questionNo).type===topType[0])?.detail.questionNo??0).bg,
                          color: getQType(items.find(i=>getQType(i.detail.questionNo).type===topType[0])?.detail.questionNo??0).color,
                          fontWeight:600 }}>
                          최다 취약: {topType[0]} ({topType[1]}회)
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize:14, color:"#94a3b8" }}>{isOpen ? "▲" : "▼"}</span>
                  </div>

                  {isOpen && (
                    <div style={{ padding:"12px 14px" }}>
                      {/* 이 학생의 유형별 칩 */}
                      <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
                        {Object.entries(typeCnt).sort((a,b)=>b[1]-a[1]).map(([type, cnt]) => {
                          const qnum = items.find(i=>getQType(i.detail.questionNo).type===type)?.detail.questionNo ?? 0;
                          const s = getQType(qnum);
                          return (
                            <span key={type} style={{ fontSize:11, padding:"3px 10px", borderRadius:8,
                              background:s.bg, color:s.color, fontWeight:600,
                              border:`1px solid ${s.color}40` }}>
                              {type} {cnt}회
                            </span>
                          );
                        })}
                      </div>

                      {/* 정밀조사 상세 테이블 */}
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ borderCollapse:"collapse", width:"100%", fontSize:11, minWidth:700, tableLayout:"fixed" }}>
                          <thead>
                            <tr style={{ background:"#f1f5f9" }}>
                              {[
                                { label:"날짜", w:"60px" }, { label:"시험", w:"80px" },
                                { label:"문항·유형", w:"100px" }, { label:"선택", w:"40px" },
                                { label:"자신감", w:"54px" }, { label:"선택 이유", w:"16%" },
                                { label:"놓친 신호", w:"16%" }, { label:"다음 행동", w:"18%" },
                              ].map(h => (
                                <th key={h.label} style={{ padding:"6px 8px", textAlign:"left",
                                  borderBottom:"1.5px solid #e2e8f0", color:"#64748b", fontWeight:600,
                                  width:h.w, whiteSpace:"nowrap" }}>{h.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {items
                              .sort((a,b)=>b.date.localeCompare(a.date))
                              .map((item, i) => {
                                const qinfo = getQType(item.detail.questionNo);
                                const isRepeat = (rmap[item.detail.questionNo] ?? 0) >= 2;
                                return (
                                  <tr key={i} style={{ background: isRepeat ? "#fff5f5" : i%2===0?"#fff":"#fafafa",
                                    borderBottom:"1px solid #f1f5f9" }}>
                                    <td style={{ padding:"7px 8px", color:"#64748b", whiteSpace:"nowrap" }}>{item.date.slice(5)}</td>
                                    <td style={{ padding:"7px 8px", color:"#64748b", overflow:"hidden",
                                      textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={item.examName}>
                                      {item.examName.slice(0,6)}
                                    </td>
                                    <td style={{ padding:"7px 8px" }}>
                                      <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                                        <span style={{ fontWeight:700,
                                          color: isRepeat ? "#dc2626" : "#1e293b" }}>
                                          {item.detail.questionNo}번 {isRepeat && "🔁"}
                                        </span>
                                        <span style={{ fontSize:10, padding:"1px 5px", borderRadius:4,
                                          background:qinfo.bg, color:qinfo.color, fontWeight:600,
                                          display:"inline-block", whiteSpace:"nowrap" }}>
                                          {qinfo.type}
                                        </span>
                                      </div>
                                    </td>
                                    <td style={{ padding:"7px 8px", textAlign:"center", fontWeight:700,
                                      color:"#92400e" }}>{item.detail.chosenOption || "-"}</td>
                                    <td style={{ padding:"7px 8px", textAlign:"center" }}>
                                      <span style={{ fontSize:11, fontWeight:700,
                                        color: (item.detail.confidenceBefore??50) >= 70 ? "#059669"
                                          : (item.detail.confidenceBefore??50) >= 40 ? "#d97706" : "#dc2626" }}>
                                        {item.detail.confidenceBefore ?? "-"}%
                                      </span>
                                    </td>
                                    <td style={{ padding:"7px 8px", color:"#374151", wordBreak:"break-all",
                                      lineHeight:1.5, whiteSpace:"normal" }}>
                                      {item.detail.reasonStudent || <span style={{color:"#cbd5e1"}}>미입력</span>}
                                    </td>
                                    <td style={{ padding:"7px 8px", color:"#dc2626", wordBreak:"break-all",
                                      lineHeight:1.5, whiteSpace:"normal" }}>
                                      {item.detail.missedSignal || <span style={{color:"#cbd5e1"}}>미입력</span>}
                                    </td>
                                    <td style={{ padding:"7px 8px", color:"#059669", fontWeight:600,
                                      wordBreak:"break-all", lineHeight:1.5, whiteSpace:"normal" }}>
                                      {item.detail.studentNextAction || <span style={{color:"#cbd5e1", fontWeight:400}}>미입력</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>

                      {/* 근거 문장 별도 표시 */}
                      {items.some(i => i.detail.evidenceSentence) && (
                        <div style={{ marginTop:10 }}>
                          <p style={{ fontSize:11, fontWeight:600, color:"#64748b", marginBottom:6 }}>근거 문장 이력</p>
                          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                            {items.filter(i => i.detail.evidenceSentence).map((item, i) => (
                              <div key={i} style={{ padding:"6px 10px", background:"#f0fdf4",
                                borderRadius:6, border:"1px solid #bbf7d0", fontSize:11 }}>
                                <span style={{ color:"#94a3b8", marginRight:6 }}>{item.date.slice(5)} {item.detail.questionNo}번</span>
                                <span style={{ color:"#166534", fontStyle:"italic" }}>{item.detail.evidenceSentence}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* ③ 지속 모니터링: 자신감 낮은 문항 경보 */}
      <div style={{ marginBottom:16 }}>
        <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", marginBottom:12 }}>
          모니터링 경보 — 자신감 40% 미만 반복 오답
        </h3>
        {(() => {
          const alerts: Array<{studentName:string; qno:number; type:string; cnt:number; avgConf:number}> = [];
          activeStudents.filter(code => !selected || code === selected).forEach(code => {
            const studentName = roster.find(r=>r.studentCode===code)?.name ?? code;
            const items = byStudentDetails.get(code) ?? [];
            const qGroups: Record<number, number[]> = {};
            items.forEach(i => {
              const n = i.detail.questionNo;
              if (!qGroups[n]) qGroups[n] = [];
              qGroups[n].push(i.detail.confidenceBefore ?? 50);
            });
            Object.entries(qGroups).forEach(([qno, confs]) => {
              const avg = Math.round(confs.reduce((s,c)=>s+c,0)/confs.length);
              if (confs.length >= 2 && avg < 50) {
                alerts.push({ studentName, qno:Number(qno), type:getQType(Number(qno)).type, cnt:confs.length, avgConf:avg });
              }
            });
          });
          if (alerts.length === 0) return (
            <p style={{ fontSize:12, color:"#94a3b8", padding:"12px 0" }}>현재 경보 없음 ✅</p>
          );
          return (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {alerts.sort((a,b)=>a.avgConf-b.avgConf).map((a, i) => (
                <div key={i} style={{ padding:"10px 14px", borderRadius:10,
                  background:"#fff5f5", border:"1.5px solid #fca5a5",
                  display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                  <span style={{ fontWeight:700, color:"#dc2626", fontSize:13 }}>{a.studentName}</span>
                  <span style={{ fontSize:12, fontWeight:700, color:"#1e293b" }}>{a.qno}번</span>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6,
                    background:getQType(a.qno).bg, color:getQType(a.qno).color, fontWeight:600 }}>
                    {a.type}
                  </span>
                  <span style={{ fontSize:11, color:"#dc2626", fontWeight:700 }}>
                    자신감 평균 {a.avgConf}% ({a.cnt}회 반복)
                  </span>
                  <span style={{ fontSize:11, color:"#64748b" }}>→ 집중 지도 필요</span>
                </div>
              ))}
            </div>
          );
        })()}
      </div>
      {/* ④ 과제 정밀 분석 섹션 */}
      {assignmentSubs.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", marginBottom:12 }}>
            과제 정밀 분석 이력
          </h3>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {(() => {
              // 학생별로 그룹화
              const byStudentMap = new Map<string, AssignmentSubmission[]>();
              assignmentSubs.forEach(s => {
                if (!byStudentMap.has(s.studentCode)) byStudentMap.set(s.studentCode, []);
                byStudentMap.get(s.studentCode)!.push(s);
              });
              return Array.from(byStudentMap.entries()).map(([code, subs]) => {
                const studentName = roster.find(r=>r.studentCode===code)?.name ?? code;
                return (
                  <div key={code} style={{ border:"1.5px solid #e2e8f0", borderRadius:12, overflow:"hidden" }}>
                    <div style={{ padding:"10px 14px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
                      <span style={{ fontWeight:700, fontSize:14 }}>{studentName}</span>
                      <span style={{ fontSize:11, color:"#94a3b8", marginLeft:8 }}>과제 분석 {subs.length}건</span>
                    </div>
                    <div style={{ padding:"12px 14px", display:"flex", flexDirection:"column", gap:12 }}>
                      {subs.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)).map((sub, si) => {
                        const cat = sub.analysisData!.category;
                        const catLabel = cat==="vocabulary"?"어휘":cat==="grammar"?"어법":
                          cat==="essay"?"서술형":cat==="mockexam"?"모의고사":"독해";
                        const catColor = cat==="vocabulary"?"#7c3aed":cat==="grammar"?"#2563eb":
                          cat==="essay"?"#db2777":cat==="mockexam"?"#dc2626":"#0891b2";
                        const catBg = cat==="vocabulary"?"#ede9fe":cat==="grammar"?"#dbeafe":
                          cat==="essay"?"#fce7f3":cat==="mockexam"?"#fee2e2":"#cffafe";
                        const questions = ANALYSIS_QUESTIONS[cat];
                        return (
                          <div key={si} style={{ border:"1px solid #f1f5f9", borderRadius:8, overflow:"hidden" }}>
                            <div style={{ padding:"7px 12px", background:catBg,
                              display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                              <span style={{ fontSize:12, fontWeight:700, color:catColor,
                                background:"#fff", padding:"2px 8px", borderRadius:6 }}>
                                {catLabel}
                              </span>
                              <span style={{ fontSize:11, color:"#64748b" }}>
                                {sub.submittedAt.slice(0,10)}
                              </span>
                              {sub.score != null && (
                                <span style={{ fontSize:11, fontWeight:700,
                                  color: sub.score>=90?"#059669":sub.score>=70?"#2563eb":"#ef4444" }}>
                                  {sub.score}점
                                </span>
                              )}
                            </div>
                            <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:8 }}>
                              {sub.analysisData!.answers.map((ans, ai) => {
                                const q = questions.find(q=>q.id===ans.questionId);
                                if (!q) return null;
                                return (
                                  <div key={ai} style={{ fontSize:12 }}>
                                    <span style={{ color:"#94a3b8", fontWeight:600 }}>Q. {q.question} </span>
                                    {ans.rating && (
                                      <span style={{ color:ans.rating>=4?"#059669":ans.rating>=3?"#d97706":"#dc2626",
                                        fontWeight:700 }}>
                                        {"😟😕😐😊😄"[ans.rating-1]}
                                        {" "+["많이 어려워요","조금 어려워요","보통이에요","잘 됐어요","완벽해요"][ans.rating-1]}
                                      </span>
                                    )}
                                    {ans.text && <span style={{ color:"#374151" }}>→ {ans.text}</span>}
                                    {ans.choice && (
                                      <span style={{ background:catBg, color:catColor,
                                        padding:"1px 7px", borderRadius:6, fontWeight:600, marginLeft:4 }}>
                                        {ans.choice}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 📋 상담요약 8줄 패널
// ═══════════════════════════════════════════════════════════════
const REASON_KO_S8: Record<string,string> = {
  Vocabulary:"어휘력", Reading:"독해력", Inference:"추론력", Logic:"논리력",
  Grammar:"어법", Time:"시간관리", Careless:"부주의", Guess:"찍기습관", DidntKnow:"개념부족"
};
const REASON_FIX_S8: Record<string,string> = {
  Vocabulary:"수능 빈출 어휘 주제별 암기 강화",
  Reading:"단락 핵심어 파악 및 전후 문맥 훈련",
  Inference:"근거 문장 확정 후 선지 소거 훈련",
  Logic:"접속어·지시어 중심 논리 추적 훈련",
  Grammar:"핵심 어법 5유형 반복 정리",
  Time:"구간별 목표 시간 설정 실전 훈련",
  Careless:"30초 검토 습관 형성",
  Guess:"어휘·독해 기반 강화로 확신도 향상",
  DidntKnow:"기초 개념 단계별 보완"
};

interface S8Student {
  student: RosterEntry;
  canGenerate: boolean;
  reason?: string;
  examCount: number;
  avgScore: number;
  summary?: string;
}

function makeSummary8(student: RosterEntry, rows: ExamResult[]): string {
  const sorted = [...rows].sort((a,b) => a.date.localeCompare(b.date));
  const scores = sorted.map(r => r.score);
  const avg = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
  const latest = sorted[sorted.length-1];
  const prev = sorted[sorted.length-2];
  const trend = prev ? latest.score - prev.score : 0;
  const trendStr = trend > 3 ? `${trend}점 상승` : trend < -3 ? `${Math.abs(trend)}점 하락` : "보합세";
  const grade = avg >= 90 ? "1등급권" : avg >= 80 ? "2등급권" : avg >= 70 ? "3등급권" : avg >= 60 ? "4등급권" : "5등급권";

  const cnt: Record<string,number> = {};
  sorted.forEach(r => (r.wrongAnswers??[]).forEach((w:any) =>
    (w.reasons||[]).forEach((rs:string) => { cnt[rs]=(cnt[rs]||0)+1; })));
  const top3 = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,3);
  const t1 = top3[0]?.[0]??""; const t2 = top3[1]?.[0]??""; const t3 = top3[2]?.[0]??"";

  const reflections = sorted.map(r => (r as any).reflection).filter(Boolean);
  const goals = reflections.map((r:any)=>r.nextGoal).filter(Boolean).slice(-2).join(", ");
  const hards = reflections.map((r:any)=>r.hardestReason).filter(Boolean).slice(-2).join(" / ");

  return [
    `① ${student.name} 학생의 현재 영어 수준은 ${grade}(기간 평균 ${avg}점)으로, 총 ${rows.length}회 시험 데이터를 바탕으로 평가합니다.`,
    `② 이번 기간 점수 흐름은 ${trendStr}이며, 최근 시험에서 ${latest.score}점을 기록하였습니다.`,
    `③ 누적 오답 원인 1위는 '${REASON_KO_S8[t1]??t1}'으로, ${REASON_FIX_S8[t1]??"집중 보완이 진행 중"}입니다.`,
    `④ ${t2 ? `'${REASON_KO_S8[t2]??t2}'` : "부수적 취약 영역"}${t3 ? `과 '${REASON_KO_S8[t3]??t3}'` : ""}도 함께 관리 중이며, 복합적 원인 분석을 진행하고 있습니다.`,
    `⑤ 학생 스스로는 "${hards||"전반적 어려움"}"을 주요 어려움으로 인식하고 있으며, "${goals||"성적 향상"}"을 목표로 삼고 있습니다.`,
    `⑥ 이번 기간 제출 데이터 ${rows.length}건을 검토한 결과, ${avg >= 80 ? "성실한 학습 참여" : avg >= 65 ? "꾸준한 참여가 확인되나 심화 훈련 필요" : "과제 성실도 향상과 기초 보완이 시급"}합니다.`,
    `⑦ 단기 처방으로 ${REASON_FIX_S8[t1]??"기초 보완"}을 집중 진행${t2 ? `, ${REASON_FIX_S8[t2]??"추가 훈련"} 병행` : ""}하고 있습니다.`,
    `⑧ 다음 달 목표는 ${Math.min(avg+5, 100)}점 이상이며, 가정에서의 지속적인 격려와 학습 환경 지원이 성장에 큰 힘이 됩니다.`,
  ].join("\n");
}

function Summary8Panel({ roster, results, assignmentSubs, summary8Map, setSummary8Map }: {
  roster: RosterEntry[];
  results: ExamResult[];
  assignmentSubs: AssignmentSubmission[];
  summary8Map: Map<string,string>;
  setSummary8Map: React.Dispatch<React.SetStateAction<Map<string,string>>>;
}) {
  const byStudent = useMemo(() => {
    const m = new Map<string,ExamResult[]>();
    results.forEach(r => {
      const code = r.student?.studentCode ?? (r as any).studentCode ?? "";
      if (!code) return;
      const a = m.get(code)??[]; a.push(r); m.set(code,a);
    });
    return m;
  }, [results]);

  const [period, setPeriod] = useState("3");
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const summaries = summary8Map;
  const setSummaries = setSummary8Map;
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");

  const MIN_EXAMS = 2;
  const cutoff = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - parseInt(period));
    return d.toISOString().slice(0,10);
  }, [period]);

  const studentList = useMemo<S8Student[]>(() => {
    return roster.map(s => {
      const allRows = byStudent.get(s.studentCode) ?? [];
      const rows = allRows.filter(r => r.date >= cutoff);
      const canGenerate = rows.length >= MIN_EXAMS;
      return {
        student: s,
        canGenerate,
        reason: !canGenerate ? `시험 데이터 ${rows.length}건 (최소 ${MIN_EXAMS}건 필요)` : undefined,
        examCount: rows.length,
        avgScore: rows.length ? Math.round(rows.reduce((a,b)=>a+b.score,0)/rows.length) : 0,
      };
    });
  }, [roster, byStudent, cutoff]);

  const canList = studentList.filter(s => s.canGenerate);
  const cantList = studentList.filter(s => !s.canGenerate);

  function toggleAll() {
    if (selectedCodes.size === canList.length) setSelectedCodes(new Set());
    else setSelectedCodes(new Set(canList.map(s => s.student.studentCode)));
  }

  async function generateAll() {
    if (selectedCodes.size === 0) { alert("대상 학생을 선택하세요."); return; }
    setGenerating(true);
    const newMap = new Map(summaries);
    const targets = canList.filter(s => selectedCodes.has(s.student.studentCode));
    for (let i=0; i<targets.length; i++) {
      const s = targets[i];
      setProgress(`${i+1}/${targets.length} — ${s.student.name} 생성 중...`);
      const rows = (byStudent.get(s.student.studentCode)??[]).filter(r => r.date >= cutoff);
      newMap.set(s.student.studentCode, makeSummary8(s.student, rows));
      setSummaries(new Map(newMap));
      await new Promise(r => setTimeout(r, 100));
    }
    setProgress("✅ 생성 완료!");
    setGenerating(false);
    setTimeout(() => setProgress(""), 3000);
  }

  function downloadTxt() {
    const lines: string[] = [`[L16] 상담요약 8줄 — ${new Date().toLocaleDateString("ko-KR")} 기준\n`];
    canList.filter(s => summaries.has(s.student.studentCode)).forEach(s => {
      lines.push(`${"=".repeat(40)}`);
      lines.push(`【${s.student.name}】 ${s.student.school} ${s.student.grade}학년`);
      lines.push(`평균: ${s.avgScore}점 / 시험: ${s.examCount}회`);
      lines.push("");
      lines.push(summaries.get(s.student.studentCode)!);
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `상담요약_${new Date().toISOString().slice(0,10)}.txt`;
    a.click();
  }

  async function downloadDocx() {
    // docx 라이브러리 없이 HTML → Blob으로 Word 호환 파일 생성
    const rows = canList.filter(s => summaries.has(s.student.studentCode));
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'>
<head><meta charset='utf-8'><style>
body{font-family:'맑은 고딕',sans-serif;font-size:12pt;margin:2cm}
h1{font-size:16pt;color:#0f766e;border-bottom:2pt solid #0f766e;padding-bottom:6pt}
h2{font-size:13pt;color:#1e40af;margin-top:18pt;margin-bottom:4pt}
.meta{font-size:10pt;color:#64748b;margin-bottom:8pt}
.line{margin:4pt 0;font-size:11pt;line-height:1.8}
.divider{border:none;border-top:1pt solid #e2e8f0;margin:14pt 0}
</style></head><body>
<h1>L16 학생 상담요약 8줄</h1>
<p style='font-size:10pt;color:#64748b'>생성일: ${new Date().toLocaleDateString("ko-KR")} · 대상: ${rows.length}명</p>
${rows.map(s => `
<hr class='divider'/>
<h2>${s.student.name}</h2>
<p class='meta'>${s.student.school} ${s.student.grade}학년 · 평균 ${s.avgScore}점 · 시험 ${s.examCount}회</p>
${(summaries.get(s.student.studentCode)!).split("\n").map(l=>`<p class='line'>${l}</p>`).join("")}
`).join("")}
</body></html>`;
    const blob = new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `상담요약_${new Date().toISOString().slice(0,10)}.doc`;
    a.click();
  }

  const generatedCount = canList.filter(s => summaries.has(s.student.studentCode)).length;

  return (
    <div>
      {/* ── 상단 컨트롤 ── */}
      <div style={{ background:"#f0fdf4", border:"1.5px solid #6ee7b7", borderRadius:12, padding:"16px 18px", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <span style={{ fontWeight:700, fontSize:15, color:"#065f46" }}>📋 상담요약 8줄 일괄 생성</span>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <label style={{ fontSize:13, color:"#374151" }}>기준 기간</label>
            <select value={period} onChange={e => { setPeriod(e.target.value); setSummaries(new Map()); setSelectedCodes(new Set()); }}
              style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #6ee7b7", fontSize:13 }}>
              <option value="1">최근 1개월</option>
              <option value="2">최근 2개월</option>
              <option value="3">최근 3개월</option>
              <option value="6">최근 6개월</option>
              <option value="12">최근 1년</option>
            </select>
          </div>
          {generatedCount > 0 && (
            <div style={{ display:"flex", gap:8, marginLeft:"auto" }}>
              <button onClick={downloadTxt}
                style={{ padding:"7px 14px", borderRadius:8, border:"1px solid #0f766e", background:"#fff", color:"#0f766e", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                📄 TXT 저장
              </button>
              <button onClick={downloadDocx}
                style={{ padding:"7px 14px", borderRadius:8, border:"none", background:"#1d4ed8", color:"#fff", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                📝 DOC 저장
              </button>
            </div>
          )}
        </div>
        {progress && <p style={{ marginTop:8, fontSize:13, fontWeight:600, color:"#0f766e" }}>{progress}</p>}
      </div>

      {/* ── 생성 가능 학생 ── */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
          <h3 style={{ margin:0, color:"#065f46" }}>✅ 생성 가능 ({canList.length}명)</h3>
          <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:13, cursor:"pointer" }}>
            <input type="checkbox" checked={selectedCodes.size === canList.length && canList.length > 0}
              onChange={toggleAll} style={{ width:15, height:15 }} />
            전체 선택
          </label>
          <button onClick={generateAll} disabled={generating || selectedCodes.size === 0}
            style={{ marginLeft:"auto", padding:"8px 18px", borderRadius:9, border:"none",
              background: selectedCodes.size === 0 ? "#e5e7eb" : "#10b981",
              color: selectedCodes.size === 0 ? "#9ca3af" : "#fff",
              fontWeight:700, fontSize:13, cursor: selectedCodes.size === 0 ? "not-allowed" : "pointer" }}>
            {generating ? "생성 중..." : `⚡ 선택 ${selectedCodes.size}명 일괄 생성`}
          </button>
        </div>

        <div style={{ border:"1px solid #d1fae5", borderRadius:10, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr style={{ background:"#ecfdf5" }}>
                <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:600, color:"#065f46", width:36 }}></th>
                <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:600, color:"#065f46" }}>학생</th>
                <th style={{ padding:"8px 12px", textAlign:"center", fontWeight:600, color:"#065f46" }}>시험</th>
                <th style={{ padding:"8px 12px", textAlign:"center", fontWeight:600, color:"#065f46" }}>평균</th>
                <th style={{ padding:"8px 12px", textAlign:"center", fontWeight:600, color:"#065f46" }}>상태</th>
              </tr>
            </thead>
            <tbody>
              {canList.map((s, i) => {
                const hasSummary = summaries.has(s.student.studentCode);
                return (
                  <tr key={s.student.studentCode} style={{ borderTop:"1px solid #d1fae5", background: i%2===0 ? "#fff" : "#f0fdf4" }}>
                    <td style={{ padding:"8px 12px" }}>
                      <input type="checkbox" checked={selectedCodes.has(s.student.studentCode)}
                        onChange={() => {
                          const n = new Set(selectedCodes);
                          n.has(s.student.studentCode) ? n.delete(s.student.studentCode) : n.add(s.student.studentCode);
                          setSelectedCodes(n);
                        }} style={{ width:15, height:15 }} />
                    </td>
                    <td style={{ padding:"8px 12px" }}>
                      <span style={{ fontWeight:600 }}>{s.student.name}</span>
                      <span style={{ fontSize:11, color:"#6b7280", marginLeft:6 }}>{s.student.school} {s.student.grade}학년</span>
                    </td>
                    <td style={{ padding:"8px 12px", textAlign:"center" }}>{s.examCount}회</td>
                    <td style={{ padding:"8px 12px", textAlign:"center", fontWeight:600,
                      color: s.avgScore>=80 ? "#059669" : s.avgScore>=65 ? "#d97706" : "#dc2626" }}>
                      {s.avgScore}점
                    </td>
                    <td style={{ padding:"8px 12px", textAlign:"center" }}>
                      {hasSummary
                        ? <span style={{ background:"#d1fae5", color:"#065f46", padding:"2px 8px", borderRadius:6, fontSize:11, fontWeight:700 }}>완료</span>
                        : <span style={{ background:"#f3f4f6", color:"#9ca3af", padding:"2px 8px", borderRadius:6, fontSize:11 }}>대기</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 생성 불가 학생 ── */}
      {cantList.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <h3 style={{ margin:"0 0 10px", color:"#9ca3af" }}>⚠️ 생성 불가 ({cantList.length}명) — 데이터 부족</h3>
          <div style={{ border:"1px solid #fee2e2", borderRadius:10, overflow:"hidden" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead>
                <tr style={{ background:"#fef2f2" }}>
                  <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:600, color:"#991b1b" }}>학생</th>
                  <th style={{ padding:"8px 12px", textAlign:"left", fontWeight:600, color:"#991b1b" }}>생성 불가 사유</th>
                </tr>
              </thead>
              <tbody>
                {cantList.map((s, i) => (
                  <tr key={s.student.studentCode} style={{ borderTop:"1px solid #fee2e2", background: i%2===0 ? "#fff" : "#fff7f7" }}>
                    <td style={{ padding:"8px 12px", fontWeight:600 }}>{s.student.name}
                      <span style={{ fontSize:11, color:"#6b7280", marginLeft:6 }}>{s.student.school} {s.student.grade}학년</span>
                    </td>
                    <td style={{ padding:"8px 12px", color:"#dc2626", fontSize:12 }}>{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 생성된 요약 전체 보기 ── */}
      {generatedCount > 0 && (
        <div>
          <h3 style={{ margin:"0 0 14px", color:"#1e40af" }}>📄 생성된 상담요약 ({generatedCount}명)</h3>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {canList.filter(s => summaries.has(s.student.studentCode)).map(s => (
              <div key={s.student.studentCode} style={{ border:"1.5px solid #bfdbfe", borderRadius:12, padding:"16px 18px", background:"#eff6ff" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
                  <div>
                    <span style={{ fontWeight:700, fontSize:15, color:"#1e40af" }}>{s.student.name}</span>
                    <span style={{ fontSize:12, color:"#6b7280", marginLeft:8 }}>{s.student.school} {s.student.grade}학년</span>
                    <span style={{ fontSize:12, color:"#1e40af", marginLeft:8 }}>평균 {s.avgScore}점 · {s.examCount}회</span>
                  </div>
                  <button onClick={() => navigator.clipboard.writeText(summaries.get(s.student.studentCode)!)}
                    style={{ padding:"4px 12px", borderRadius:7, border:"1px solid #93c5fd", background:"#fff", color:"#1d4ed8", fontSize:12, cursor:"pointer", fontWeight:600 }}>
                    복사
                  </button>
                </div>
                <div style={{ fontSize:13, lineHeight:2, color:"#1e293b", whiteSpace:"pre-wrap", background:"#fff", borderRadius:8, padding:"12px 14px", border:"1px solid #bfdbfe" }}>
                  {summaries.get(s.student.studentCode)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

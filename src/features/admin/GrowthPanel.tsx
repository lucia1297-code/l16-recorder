import { useEffect, useMemo, useState } from "react";
import type { ExamResult } from "../../core/types";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

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
  const rows = await res.json();
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
  if (!res.ok) throw new Error(await res.text());
}

export default function GrowthPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [viewTab, setViewTab] = useState<"compare" | "message">("compare");
  const [messages, setMessages] = useState<GrowthMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem("l16.growthMessages") || "[]"); } catch { return []; }
  });
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
  }, [rosterStore]);

  function saveMsgs(msgs: GrowthMessage[]) {
    setMessages(msgs);
    localStorage.setItem("l16.growthMessages", JSON.stringify(msgs));
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
    const s = roster.find(r => r.studentCode === msg.studentCode);
    const phone = s?.parentPhone || s?.phone;
    if (!phone) return alert("전화번호가 없습니다.");
    setSending(msg.id);
    try {
      await sendSMS(phone, msg.content);
      saveMsgs(messages.map(m => m.id === msg.id ? { ...m, sentAt: new Date().toISOString() } : m));
      setNotice(`${msg.studentName} 발송 완료`);
      setTimeout(() => setNotice(""), 3000);
    } catch(e) { alert("발송 실패: " + (e as Error).message); }
    finally { setSending(null); }
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
        <h2 style={{ margin:0, color:"#0f766e" }}>📈 발전 기록</h2>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <select value={selected} onChange={e => setSelected(e.target.value)}
            style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
            <option value="">전체 학생</option>
            {active.map(r => <option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
          </select>
          <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2 }}>
            {(["compare", "message"] as const).map(t => (
              <button key={t} onClick={() => setViewTab(t)}
                style={{ padding:"5px 14px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, cursor:"pointer",
                  background: viewTab === t ? "#0f766e" : "transparent",
                  color: viewTab === t ? "#fff" : "#64748b" }}>
                {t === "compare" ? "📊 비교 분석" : "💌 처방 메시지"}
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
                          💊 처방 생성
                        </button>
                        <button onClick={() => { setReportModal({code, name: roster.find(r=>r.studentCode===code)?.name ?? ""}); }}
                          style={{ padding:"6px 12px", borderRadius:8, border:"1.5px solid #0f766e", background:"#fff",
                            color:"#0f766e", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                          📋 상담평가서
                        </button>
                      </div>
                    </div>

                    <div style={{ padding:"14px 16px" }}>
                      {/* ① 점수 추이 */}
                      <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>📅 점수 추이</p>
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
                            ⚠️ 오답 원인 누적
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
                            🔁 반복 오답 문항 (2회↑)
                          </p>
                          {repeatWrong.length === 0 ? (
                            <p style={{ fontSize:12, color:"#94a3b8" }}>반복 오답 없음 👍</p>
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
                      <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>📝 회고 이력 비교</p>
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

      {/* ══ 처방 메시지 ══ */}
      {viewTab === "message" && (
        <div>
          {messages.filter(m => !selected || m.studentCode === selected).length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
              <p style={{ fontSize:32, marginBottom:8 }}>💊</p>
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
                        ✅ 발송 {new Date(msg.sentAt).toLocaleDateString("ko-KR")}
                      </span>}
                      {msg.adminEdited && <span style={{ fontSize:11, color:"#7c3aed", marginLeft:6 }}>✏️ 수정됨</span>}
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
                            style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #e2e8f0", background:"#fff", fontSize:12, cursor:"pointer" }}>✏️ 수정</button>
                          <button onClick={() => sendMsg(msg)} disabled={sending === msg.id}
                            style={{ padding:"4px 10px", borderRadius:6, border:"none",
                              background: msg.sentAt ? "#f1f5f9" : "#0f766e",
                              color: msg.sentAt ? "#64748b" : "#fff", fontSize:12, cursor:"pointer", fontWeight:600 }}>
                            {sending === msg.id ? "발송 중…" : msg.sentAt ? "📱 재발송" : "📱 발송"}
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
            <h3 style={{ margin:"0 0 16px", color:"#0f766e" }}>📋 상담평가서 작성</h3>
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

    </div>
  );
}
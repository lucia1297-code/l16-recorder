import { useEffect, useMemo, useState } from "react";
import type { ExamResult } from "../../core/types";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── 타입 ──────────────────────────────────────────────
interface GrowthMessage {
  id: string;
  studentCode: string;
  studentName: string;
  content: string;
  createdAt: string;
  sentAt: string | null;
  adminEdited: boolean;
}

// ── 상수 ──────────────────────────────────────────────
const REASON_KO: Record<string, string> = {
  Vocabulary:"어휘", Grammar:"어법", Reading:"독해", Inference:"추론",
  Logic:"논리", Time:"시간부족", Careless:"실수", Guess:"찍음", DidntKnow:"모름", Other:"기타"
};
const REASON_COLOR: Record<string, string> = {
  Vocabulary:"#7c3aed", Grammar:"#2563eb", Reading:"#0891b2", Inference:"#059669",
  Logic:"#d97706", Time:"#dc2626", Careless:"#db2777", Guess:"#64748b", DidntKnow:"#374151", Other:"#94a3b8"
};

// ── API ───────────────────────────────────────────────
async function fetchResults(): Promise<ExamResult[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/results?select=*&order=date.asc,submitted_at.asc`,
    { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r: any) => ({
    id: r.id,
    student: { studentCode: r.student_code, name: r.name, school: r.school, grade: r.grade },
    exam: { examName: r.exam_name, year: 0, month: 0, round: 0, totalQuestions: 45, maxScore: 100 },
    teacher: "",
    date: r.date ?? r.submitted_at?.slice(0, 10),
    score: Number(r.score),
    wrongAnswers: (() => { try { return JSON.parse(r.wrong_answers || "[]"); } catch { return []; } })(),
    reflection: (() => { try { return JSON.parse(r.reflection || "{}"); } catch { return {}; } })(),
    submittedAt: r.submitted_at,
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
    headers: { "Content-Type": "application/json",
      "Authorization": `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}` },
    body: JSON.stringify({ message: { to, from: sender, text: message } }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── 메인 컴포넌트 ─────────────────────────────────────
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

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    fetchResults().then(r => { setResults(r); setLoading(false); });
  }, [rosterStore]);

  function saveMsgs(msgs: GrowthMessage[]) {
    setMessages(msgs);
    localStorage.setItem("l16.growthMessages", JSON.stringify(msgs));
  }

  // 학생별 결과 집계
  const byStudent = useMemo(() => {
    const map = new Map<string, ExamResult[]>();
    results.forEach(r => {
      const k = r.student.studentCode;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    });
    return map;
  }, [results]);

  // 처방 생성
  function makeDiagnosis(code: string, name: string): string {
    const rows = byStudent.get(code) || [];
    if (!rows.length) return "";
    const recent = rows.slice(-3);
    const avg = Math.round(recent.reduce((s, r) => s + r.score, 0) / recent.length);
    const trend = rows.length >= 2 ? rows[rows.length-1].score - rows[rows.length-2].score : 0;
    const cnt: Record<string, number> = {};
    recent.forEach(r => r.wrongAnswers.forEach(w => w.reasons.forEach(rs => { cnt[rs] = (cnt[rs] || 0) + 1; })));
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => REASON_KO[r] ?? r);
    const ref = (recent[recent.length-1].reflection as any) || {};
    return `[${name} 학생 주간 처방]\n\n📊 최근 평균: ${avg}점 (${trend >= 0 ? "▲" : "▼"}${Math.abs(trend)}점)\n⚠️ 주요 오답: ${top.join(", ")}\n\n📝 학생 회고:\n• 어려웠던 점: ${ref.hardestReason || "미작성"}\n• 다음 목표: ${ref.nextGoal || "미작성"}\n\n💊 처방:\n${top.includes("어휘") ? "• 어휘 암기 하루 30개 이상\n" : ""}${top.includes("독해") ? "• 지문 정독 — 핵심 문장 먼저 찾기\n" : ""}${top.includes("시간부족") ? "• Step별 목표 시간 엄수\n" : ""}${top.includes("실수") ? "• 마지막 5분 선지 재확인\n" : ""}${top.includes("추론") ? "• 근거 문장 찾기 훈련\n" : ""}\n수고했습니다! 다음 주도 화이팅 💪`;
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
    };
    saveMsgs([msg, ...messages]);
    setEditingId(msg.id); setEditText(content);
    setViewTab("message");
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

  // 표시할 학생 목록
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
          {/* 내부 탭 */}
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

      {/* ══ 비교 분석 뷰 ══════════════════════════════ */}
      {viewTab === "compare" && (
        <div>
          {loading ? <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>데이터 로딩 중…</p> : (
            <div style={{ display:"flex", flexDirection:"column", gap:24 }}>
              {displayStudents.map(([code, rows]) => {
                const student = roster.find(r => r.studentCode === code);
                const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
                const latest = sorted[sorted.length-1];
                const prev = sorted[sorted.length-2];
                const trend = prev ? latest.score - prev.score : 0;

                // 전체 오답 번호 집계 (몇 번 문제를 반복해서 틀리는가)
                const wrongNumCount: Record<number, number> = {};
                sorted.forEach(r => r.wrongAnswers.forEach(w => {
                  wrongNumCount[w.questionNo] = (wrongNumCount[w.questionNo] || 0) + 1;
                }));
                const repeatWrong = Object.entries(wrongNumCount)
                  .filter(([, cnt]) => cnt >= 2)
                  .sort((a, b) => Number(b[1]) - Number(a[1]))
                  .slice(0, 5);

                // 오답 원인 전체 집계
                const reasonTotal: Record<string, number> = {};
                sorted.forEach(r => r.wrongAnswers.forEach(w =>
                  w.reasons.forEach(rs => { reasonTotal[rs] = (reasonTotal[rs] || 0) + 1; })
                ));
                const topReasons = Object.entries(reasonTotal).sort((a, b) => b[1] - a[1]).slice(0, 5);

                return (
                  <div key={code} style={{ border:"1.5px solid #e2e8f0", borderRadius:14, overflow:"hidden" }}>

                    {/* 학생 헤더 */}
                    <div style={{ padding:"12px 16px", background:"#f0fdfa", borderBottom:"1px solid #e2e8f0",
                      display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <span style={{ fontWeight:700, fontSize:16, color:"#134e4a" }}>{student?.name ?? code}</span>
                        <span style={{ fontSize:12, color:"#64748b" }}>{student?.school} {student?.grade}학년</span>
                        <span style={{ fontSize:15, fontWeight:700,
                          color: trend > 0 ? "#059669" : trend < 0 ? "#ef4444" : "#64748b" }}>
                          최근 {latest.score}점 {trend !== 0 ? (trend > 0 ? `▲${trend}` : `▼${Math.abs(trend)}`) : "→"}
                        </span>
                        <span style={{ fontSize:12, color:"#94a3b8" }}>총 {sorted.length}회 제출</span>
                      </div>
                      <button onClick={() => { createMsg(code); }}
                        style={{ padding:"6px 14px", borderRadius:8, border:"none", background:"#0f766e",
                          color:"#fff", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                        💊 처방 생성
                      </button>
                    </div>

                    <div style={{ padding:"14px 16px" }}>

                      {/* ① 점수 추이 타임라인 */}
                      <div style={{ marginBottom:16 }}>
                        <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>
                          📅 점수 추이
                        </p>
                        <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"flex-end" }}>
                          {sorted.map((r, i) => {
                            const prev2 = sorted[i-1];
                            const diff = prev2 ? r.score - prev2.score : 0;
                            return (
                              <div key={i} style={{ textAlign:"center", minWidth:58 }}>
                                {diff !== 0 && (
                                  <div style={{ fontSize:10, fontWeight:700, marginBottom:2,
                                    color: diff > 0 ? "#059669" : "#ef4444" }}>
                                    {diff > 0 ? `▲${diff}` : `▼${Math.abs(diff)}`}
                                  </div>
                                )}
                                <div style={{ padding:"6px 8px", borderRadius:10, textAlign:"center",
                                  background: r === latest ? "#0f766e" : "#f1f5f9",
                                  color: r === latest ? "#fff" : "#374151",
                                  border: `2px solid ${r === latest ? "#0f766e" : "#e2e8f0"}` }}>
                                  <div style={{ fontSize:10, marginBottom:2,
                                    color: r === latest ? "#99f6e4" : "#94a3b8" }}>
                                    {r.date.slice(5).replace("-", "/")}
                                  </div>
                                  <div style={{ fontSize:18, fontWeight:700 }}>{r.score}</div>
                                  <div style={{ fontSize:9, color: r === latest ? "#99f6e4" : "#94a3b8" }}>
                                    {r.exam.examName.slice(0, 6)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>

                        {/* ② 오답 원인 분석 */}
                        <div>
                          <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>
                            ⚠️ 오답 원인 누적 ({sorted.length}회 전체)
                          </p>
                          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                            {topReasons.map(([rs, cnt]) => {
                              const total = sorted.reduce((s, r) => s + r.wrongAnswers.length, 0);
                              const pct = total > 0 ? Math.round(cnt / total * 100) : 0;
                              const color = REASON_COLOR[rs] ?? "#94a3b8";
                              return (
                                <div key={rs}>
                                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                    <span style={{ fontSize:12, fontWeight:600, color }}>{REASON_KO[rs] ?? rs}</span>
                                    <span style={{ fontSize:11, color:"#94a3b8" }}>{cnt}회 ({pct}%)</span>
                                  </div>
                                  <div style={{ background:"#f1f5f9", borderRadius:4, height:8 }}>
                                    <div style={{ width:`${pct}%`, background: color, height:8, borderRadius:4 }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* ③ 반복 오답 문항 */}
                        <div>
                          <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>
                            🔁 반복 오답 문항 (2회 이상)
                          </p>
                          {repeatWrong.length === 0 ? (
                            <p style={{ fontSize:12, color:"#94a3b8" }}>반복 오답 없음</p>
                          ) : (
                            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                              {repeatWrong.map(([num, cnt]) => (
                                <div key={num} style={{ padding:"5px 10px", borderRadius:8, textAlign:"center",
                                  background: Number(cnt) >= 3 ? "#fef2f2" : "#fff7ed",
                                  border: `1.5px solid ${Number(cnt) >= 3 ? "#fca5a5" : "#fdba74"}` }}>
                                  <div style={{ fontSize:16, fontWeight:700,
                                    color: Number(cnt) >= 3 ? "#dc2626" : "#c2410c" }}>{num}번</div>
                                  <div style={{ fontSize:10, color:"#94a3b8" }}>{cnt}회 틀림</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ④ 회고 전체 목록 비교 */}
                      <div>
                        <p style={{ fontSize:12, fontWeight:700, color:"#475569", marginBottom:8 }}>
                          📝 회고 이력 비교
                        </p>
                        <div style={{ overflowX:"auto" }}>
                          <table style={{ borderCollapse:"collapse", width:"100%", fontSize:12 }}>
                            <thead>
                              <tr style={{ background:"#f8fafc" }}>
                                <th style={{ padding:"6px 10px", textAlign:"left", borderBottom:"1.5px solid #e2e8f0",
                                  color:"#64748b", fontWeight:600, minWidth:70 }}>날짜</th>
                                <th style={{ padding:"6px 10px", textAlign:"center", borderBottom:"1.5px solid #e2e8f0",
                                  color:"#64748b", fontWeight:600, minWidth:50 }}>점수</th>
                                <th style={{ padding:"6px 10px", textAlign:"left", borderBottom:"1.5px solid #e2e8f0",
                                  color:"#64748b", fontWeight:600, minWidth:140 }}>어려웠던 점</th>
                                <th style={{ padding:"6px 10px", textAlign:"left", borderBottom:"1.5px solid #e2e8f0",
                                  color:"#64748b", fontWeight:600, minWidth:140 }}>다음 목표</th>
                                <th style={{ padding:"6px 10px", textAlign:"center", borderBottom:"1.5px solid #e2e8f0",
                                  color:"#64748b", fontWeight:600, minWidth:60 }}>만족도</th>
                                <th style={{ padding:"6px 10px", textAlign:"left", borderBottom:"1.5px solid #e2e8f0",
                                  color:"#64748b", fontWeight:600, minWidth:120 }}>틀린 문항</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sorted.map((r, i) => {
                                const ref = (r.reflection as any) || {};
                                const wrongNums = r.wrongAnswers.map(w => w.questionNo).sort((a,b)=>a-b);
                                const isLatest = i === sorted.length - 1;
                                return (
                                  <tr key={i} style={{ background: isLatest ? "#f0fdfa" : i % 2 === 0 ? "#fff" : "#f9f9f9",
                                    borderBottom:"1px solid #f1f5f9" }}>
                                    <td style={{ padding:"8px 10px", color:"#475569", whiteSpace:"nowrap" }}>
                                      {r.date.slice(5)}
                                      {isLatest && <span style={{ marginLeft:4, fontSize:10, color:"#0f766e", fontWeight:700 }}>최근</span>}
                                    </td>
                                    <td style={{ padding:"8px 10px", textAlign:"center", fontWeight:700,
                                      color: r.score >= 90 ? "#059669" : r.score >= 70 ? "#2563eb" : "#ef4444" }}>
                                      {r.score}
                                    </td>
                                    <td style={{ padding:"8px 10px", color:"#374151", maxWidth:160 }}>
                                      {ref.hardestReason || <span style={{ color:"#cbd5e1" }}>미작성</span>}
                                    </td>
                                    <td style={{ padding:"8px 10px", color:"#374151", maxWidth:160 }}>
                                      {ref.nextGoal || <span style={{ color:"#cbd5e1" }}>미작성</span>}
                                    </td>
                                    <td style={{ padding:"8px 10px", textAlign:"center" }}>
                                      {ref.satisfaction
                                        ? <span>{"★".repeat(ref.satisfaction)}{"☆".repeat(5-(ref.satisfaction||0))}</span>
                                        : <span style={{ color:"#cbd5e1" }}>-</span>}
                                    </td>
                                    <td style={{ padding:"8px 10px" }}>
                                      <div style={{ display:"flex", flexWrap:"wrap", gap:3 }}>
                                        {wrongNums.map(n => {
                                          const repeated = (wrongNumCount[n] || 0) >= 2;
                                          return (
                                            <span key={n} style={{ fontSize:11, padding:"1px 5px", borderRadius:5,
                                              background: repeated ? "#fef2f2" : "#f1f5f9",
                                              color: repeated ? "#dc2626" : "#64748b",
                                              fontWeight: repeated ? 700 : 400,
                                              border: `1px solid ${repeated ? "#fca5a5" : "#e2e8f0"}` }}>
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
                          * 빨간 문항번호 = 반복 오답 (2회 이상 틀린 문항)
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══ 처방 메시지 뷰 ════════════════════════════ */}
      {viewTab === "message" && (
        <div>
          {messages.filter(m => !selected || m.studentCode === selected).length === 0 ? (
            <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
              <p style={{ fontSize:32, marginBottom:8 }}>💊</p>
              <p>비교 분석 탭에서 학생 카드의 "처방 생성" 버튼을 눌러주세요.</p>
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
                      <span style={{ fontWeight:700, fontSize:13, color:"#1e293b" }}>{msg.studentName}</span>
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
                          }} style={{ padding:"4px 10px", borderRadius:6, border:"none",
                            background:"#0f766e", color:"#fff", fontSize:12, cursor:"pointer", fontWeight:600 }}>저장</button>
                          <button onClick={() => setEditingId(null)}
                            style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #e2e8f0",
                              background:"#fff", fontSize:12, cursor:"pointer" }}>취소</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditingId(msg.id); setEditText(msg.content); }}
                            style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #e2e8f0",
                              background:"#fff", fontSize:12, cursor:"pointer" }}>✏️ 수정</button>
                          <button onClick={() => sendMsg(msg)} disabled={sending === msg.id}
                            style={{ padding:"4px 10px", borderRadius:6, border:"none",
                              background: msg.sentAt ? "#f1f5f9" : "#0f766e",
                              color: msg.sentAt ? "#64748b" : "#fff",
                              fontSize:12, cursor:"pointer", fontWeight:600 }}>
                            {sending === msg.id ? "발송 중…" : msg.sentAt ? "📱 재발송" : "📱 발송"}
                          </button>
                          <button onClick={() => { if (!confirm("삭제?")) return; saveMsgs(messages.filter(m => m.id !== msg.id)); }}
                            style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #fca5a5",
                              background:"#fff", fontSize:12, cursor:"pointer", color:"#ef4444" }}>삭제</button>
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
                      <pre style={{ margin:0, fontSize:12, color:"#374151", whiteSpace:"pre-wrap",
                        fontFamily:"inherit", lineHeight:1.6 }}>{msg.content}</pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

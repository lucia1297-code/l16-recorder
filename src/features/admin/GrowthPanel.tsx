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
}

const REASON_KO: Record<string, string> = {
  Vocabulary:"어휘", Grammar:"어법", Reading:"독해", Inference:"추론",
  Logic:"논리", Time:"시간부족", Careless:"실수", Guess:"찍음", DidntKnow:"모름", Other:"기타"
};

async function fetchResults(): Promise<ExamResult[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/results?select=*&order=submitted_at.desc`,
    { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r: any) => ({
    id: r.id,
    student: { studentCode: r.student_code, name: r.name, school: r.school, grade: r.grade },
    exam: { examName: r.exam_name, year: 0, month: 0, round: 0, totalQuestions: 45, maxScore: 100 },
    teacher: "",
    date: r.date ?? r.submitted_at?.slice(0,10),
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
    .map(b => b.toString(16).padStart(2,"0")).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(apiSecret),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(date + salt));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
  const authHeader = `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  let to = phone.replace(/[^0-9]/g, "");
  if (to.startsWith("82")) to = "0" + to.slice(2);
  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization": authHeader },
    body: JSON.stringify({ message:{ to, from: sender, text: message } }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export default function GrowthPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<GrowthMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem("l16.growthMessages") || "[]"); } catch { return []; }
  });
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editText, setEditText] = useState("");
  const [sending, setSending] = useState<string|null>(null);
  const [notice, setNotice] = useState("");

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
    const rows = [...(byStudent.get(code) || [])].sort((a,b) => a.date.localeCompare(b.date));
    if (!rows.length) return "";
    const recent = rows.slice(-3);
    const avg = Math.round(recent.reduce((s,r)=>s+r.score,0)/recent.length);
    const trend = rows.length >= 2 ? rows[rows.length-1].score - rows[rows.length-2].score : 0;
    const cnt: Record<string,number> = {};
    recent.forEach(r => r.wrongAnswers.forEach(w => w.reasons.forEach(rs => { cnt[rs]=(cnt[rs]||0)+1; })));
    const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([r])=>REASON_KO[r]??r);
    const ref = (recent[recent.length-1].reflection as any) || {};

    return `[${name} 학생 주간 처방]

📊 최근 평균: ${avg}점 (${trend>=0?"▲":"▼"}${Math.abs(trend)}점)
⚠️ 주요 오답: ${top.join(", ")}

📝 학생 회고:
• 어려웠던 점: ${ref.hardestReason || "미작성"}
• 다음 목표: ${ref.nextGoal || "미작성"}
• 만족도: ${"★".repeat(ref.satisfaction||0)}${"☆".repeat(5-(ref.satisfaction||0))}

💊 처방:
${top.includes("어휘") ? "• 어휘 암기 하루 30개 이상\n" : ""}${top.includes("독해") ? "• 지문 정독 — 핵심 문장 먼저 찾기\n" : ""}${top.includes("시간부족") ? "• 풀이 속도 훈련 — Step 목표 시간 엄수\n" : ""}${top.includes("실수") ? "• 마지막 5분 선지 재확인 습관\n" : ""}${top.includes("추론") ? "• 추론 문제 — 근거 문장 찾기 훈련\n" : ""}
수고했습니다! 다음 주도 화이팅 💪`;
  }

  function createMsg(code: string) {
    const student = roster.find(r=>r.studentCode===code);
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
  }

  async function sendMsg(msg: GrowthMessage) {
    const s = roster.find(r=>r.studentCode===msg.studentCode);
    const phone = s?.parentPhone || s?.phone;
    if (!phone) return alert("전화번호가 없습니다.");
    setSending(msg.id);
    try {
      await sendSMS(phone, msg.content);
      saveMsgs(messages.map(m => m.id===msg.id ? {...m, sentAt:new Date().toISOString()} : m));
      setNotice(`${msg.studentName} 발송 완료`);
      setTimeout(()=>setNotice(""),3000);
    } catch(e) { alert("발송 실패: "+(e as Error).message); }
    finally { setSending(null); }
  }

  const active = roster.filter(r=>(r.studentStatus??"active")!=="withdrawn");

  return (
    <div className="card">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
        <h2 style={{margin:0,color:"#0f766e"}}>📈 발전 기록</h2>
        <select value={selected} onChange={e=>setSelected(e.target.value)}
          style={{padding:"6px 12px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:13}}>
          <option value="">전체 학생</option>
          {active.map(r=><option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
        </select>
      </div>
      {notice && <p style={{color:"#0f766e",fontWeight:600,marginBottom:10}}>{notice}</p>}

      {/* 성적 추이 */}
      <h3 style={{color:"#0f766e",marginBottom:12,fontSize:15}}>📊 모의고사 성적 추이 & 회고</h3>
      {loading ? <p style={{color:"#94a3b8"}}>로딩 중…</p> : (
        <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:24}}>
          {Array.from(byStudent.entries())
            .filter(([code])=>!selected||code===selected)
            .sort(([a],[b])=>{
              const na=roster.find(r=>r.studentCode===a)?.name??"";
              const nb=roster.find(r=>r.studentCode===b)?.name??"";
              return na.localeCompare(nb);
            })
            .map(([code,rows])=>{
              const student=roster.find(r=>r.studentCode===code);
              const sorted=[...rows].sort((a,b)=>a.date.localeCompare(b.date));
              const latest=sorted[sorted.length-1];
              const prev=sorted[sorted.length-2];
              const trend=prev?latest.score-prev.score:0;
              const cnt:Record<string,number>={};
              sorted.slice(-3).forEach(r=>r.wrongAnswers.forEach(w=>w.reasons.forEach(rs=>{cnt[rs]=(cnt[rs]||0)+1;})));
              const top=Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,3);
              const ref=(latest.reflection as any)||{};
              return (
                <div key={code} style={{border:"1px solid #e2e8f0",borderRadius:12,overflow:"hidden"}}>
                  <div style={{padding:"10px 14px",background:"#f0fdfa",borderBottom:"1px solid #e2e8f0",
                    display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontWeight:700,fontSize:14,color:"#134e4a"}}>{student?.name??code}</span>
                      <span style={{fontSize:11,color:"#64748b"}}>{student?.school}</span>
                      <span style={{fontSize:13,fontWeight:700,
                        color:trend>0?"#059669":trend<0?"#ef4444":"#64748b"}}>
                        {latest.score}점 {trend!==0?(trend>0?`▲${trend}`:`▼${Math.abs(trend)}`):"→"}
                      </span>
                    </div>
                    <button onClick={()=>createMsg(code)}
                      style={{padding:"5px 12px",borderRadius:7,border:"none",background:"#0f766e",
                        color:"#fff",fontWeight:600,fontSize:12,cursor:"pointer"}}>
                      💊 처방 생성
                    </button>
                  </div>
                  <div style={{padding:"10px 14px"}}>
                    {/* 점수 이력 */}
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                      {sorted.map((r,i)=>(
                        <div key={i} style={{textAlign:"center",padding:"4px 10px",borderRadius:8,
                          background:r===latest?"#0f766e":"#f1f5f9",color:r===latest?"#fff":"#475569"}}>
                          <div style={{fontSize:10,color:r===latest?"#99f6e4":"#94a3b8"}}>{r.date.slice(5)}</div>
                          <div style={{fontSize:14,fontWeight:700}}>{r.score}</div>
                        </div>
                      ))}
                    </div>
                    {/* 오답 원인 */}
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
                      {top.map(([rs,n])=>(
                        <span key={rs} style={{fontSize:11,padding:"2px 8px",borderRadius:10,
                          background:"#fef3c7",color:"#92400e",fontWeight:600}}>
                          {REASON_KO[rs]??rs} {n}회
                        </span>
                      ))}
                    </div>
                    {/* 회고 */}
                    {(ref.hardestReason||ref.nextGoal) && (
                      <div style={{background:"#f8fafc",borderRadius:8,padding:"8px 12px",fontSize:12}}>
                        <p style={{margin:"0 0 4px",color:"#475569"}}>
                          <span style={{color:"#94a3b8",fontWeight:600}}>어려웠던 점: </span>
                          {ref.hardestReason||"-"}
                        </p>
                        <p style={{margin:0,color:"#475569"}}>
                          <span style={{color:"#94a3b8",fontWeight:600}}>다음 목표: </span>
                          {ref.nextGoal||"-"}
                        </p>
                        {ref.satisfaction && (
                          <p style={{margin:"4px 0 0"}}>
                            {"★".repeat(ref.satisfaction)}{"☆".repeat(5-(ref.satisfaction||0))}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* 처방 메시지 */}
      <h3 style={{color:"#0f766e",marginBottom:12,fontSize:15}}>💌 처방 메시지</h3>
      {messages.filter(m=>!selected||m.studentCode===selected).length===0 ? (
        <p style={{color:"#94a3b8",textAlign:"center",padding:"20px 0"}}>
          학생 카드에서 "💊 처방 생성" 버튼을 눌러주세요.
        </p>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {messages.filter(m=>!selected||m.studentCode===selected).map(msg=>(
            <div key={msg.id} style={{border:`1.5px solid ${msg.sentAt?"#d1fae5":"#e2e8f0"}`,
              borderRadius:12,overflow:"hidden",background:msg.sentAt?"#f0fdf4":"#fff"}}>
              <div style={{padding:"10px 14px",background:msg.sentAt?"#d1fae5":"#f8fafc",
                borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",
                alignItems:"center",flexWrap:"wrap",gap:8}}>
                <div>
                  <span style={{fontWeight:700,fontSize:13}}>{msg.studentName}</span>
                  <span style={{fontSize:11,color:"#94a3b8",marginLeft:8}}>
                    {new Date(msg.createdAt).toLocaleDateString("ko-KR")}
                  </span>
                  {msg.sentAt && <span style={{fontSize:11,color:"#059669",marginLeft:8,fontWeight:600}}>
                    ✅ 발송완료
                  </span>}
                  {msg.adminEdited && <span style={{fontSize:11,color:"#7c3aed",marginLeft:6}}>✏️ 수정됨</span>}
                </div>
                <div style={{display:"flex",gap:6}}>
                  {editingId===msg.id ? (
                    <>
                      <button onClick={()=>{
                        saveMsgs(messages.map(m=>m.id===msg.id?{...m,content:editText,adminEdited:true}:m));
                        setEditingId(null);
                      }} style={{padding:"4px 10px",borderRadius:6,border:"none",background:"#0f766e",color:"#fff",fontSize:12,cursor:"pointer",fontWeight:600}}>저장</button>
                      <button onClick={()=>setEditingId(null)}
                        style={{padding:"4px 10px",borderRadius:6,border:"1px solid #e2e8f0",background:"#fff",fontSize:12,cursor:"pointer"}}>취소</button>
                    </>
                  ) : (
                    <>
                      <button onClick={()=>{setEditingId(msg.id);setEditText(msg.content);}}
                        style={{padding:"4px 10px",borderRadius:6,border:"1px solid #e2e8f0",background:"#fff",fontSize:12,cursor:"pointer"}}>✏️ 수정</button>
                      <button onClick={()=>sendMsg(msg)} disabled={sending===msg.id}
                        style={{padding:"4px 10px",borderRadius:6,border:"none",
                          background:msg.sentAt?"#f1f5f9":"#0f766e",
                          color:msg.sentAt?"#64748b":"#fff",fontSize:12,cursor:"pointer",fontWeight:600}}>
                        {sending===msg.id?"발송 중…":msg.sentAt?"📱 재발송":"📱 발송"}
                      </button>
                      <button onClick={()=>{if(!confirm("삭제?"))return;saveMsgs(messages.filter(m=>m.id!==msg.id));}}
                        style={{padding:"4px 10px",borderRadius:6,border:"1px solid #fca5a5",background:"#fff",fontSize:12,cursor:"pointer",color:"#ef4444"}}>삭제</button>
                    </>
                  )}
                </div>
              </div>
              <div style={{padding:"12px 14px"}}>
                {editingId===msg.id ? (
                  <textarea value={editText} onChange={e=>setEditText(e.target.value)} rows={10}
                    style={{width:"100%",padding:"10px",borderRadius:8,border:"1px solid #7c3aed",
                      fontSize:13,resize:"vertical",boxSizing:"border-box",fontFamily:"monospace"}} />
                ) : (
                  <pre style={{margin:0,fontSize:12,color:"#374151",whiteSpace:"pre-wrap",fontFamily:"inherit",lineHeight:1.6}}>
                    {msg.content}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

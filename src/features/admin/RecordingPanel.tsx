import { useEffect, useState, useMemo } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY as string;
const SB_H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

interface Recording {
  id: string;
  student_code: string;
  student_name: string;
  recorded_at: string;
  audio_url: string;
  duration_sec: number;
  transcript: string;
  analysis: string;
  keywords: string[];
  status: "uploaded" | "transcribing" | "done" | "error";
}

async function getSignedUrl(path: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/lesson-recordings/${path}`,
    { method: "POST", headers: { ...SB_H, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 }) }
  );
  const data = await res.json();
  return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
}

async function transcribeWithWhisper(audioUrl: string): Promise<string> {
  // 오디오 파일 다운로드
  const audioRes = await fetch(audioUrl);
  const audioBlob = await audioRes.blob();

  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("model", "whisper-1");
  formData.append("language", "ko");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}` },
    body: formData,
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.text;
}

async function analyzeWithGPT(transcript: string, studentName: string): Promise<{
  analysis: string; keywords: string[];
}> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: `당신은 수능 영어 전문 강사의 수업 분석 보조 AI입니다.
학생의 수업 녹음 텍스트를 분석하여 다음 형식으로 분석 결과를 제공합니다:

【이해도 분석】
- 학생이 이해한 개념과 그렇지 않은 부분을 구분하여 서술

【질문 패턴】
- 학생이 질문하거나 어려워하는 유형 파악

【강점】
- 잘 따라오는 부분

【보완 필요】
- 추가 지도가 필요한 영역

【지도 방향 제안】
- 다음 수업에서 집중할 내용 제안

간결하고 전문적으로 작성하세요.`
      }, {
        role: "user",
        content: `${studentName} 학생의 수업 녹음 텍스트입니다:\n\n${transcript}`
      }],
      max_tokens: 800,
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const analysis = data.choices[0].message.content;

  // 키워드 추출
  const kwRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: `다음 수업 내용에서 핵심 키워드 5개를 JSON 배열로 추출하세요. 예: ["빈칸추론","어휘","독해전략","시간관리","어법"]\n\n${transcript}`
      }],
      max_tokens: 100,
    })
  });
  const kwData = await kwRes.json();
  let keywords: string[] = [];
  try {
    const text = kwData.choices[0].message.content;
    const match = text.match(/\[.*?\]/s);
    if (match) keywords = JSON.parse(match[0]);
  } catch { keywords = []; }

  return { analysis, keywords };
}

export default function RecordingPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [expandId, setExpandId] = useState<string | null>(null);
  const [hasOpenAI, setHasOpenAI] = useState(false);

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    setHasOpenAI(Boolean(OPENAI_KEY));
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/lesson_recordings?order=recorded_at.desc`,
        { headers: SB_H }
      );
      const data = await res.json();
      setRecordings(Array.isArray(data) ? data : []);
    } catch { }
    setLoading(false);
  }

  async function processRecording(rec: Recording) {
    if (!OPENAI_KEY) {
      alert("OpenAI API Key가 설정되지 않았습니다.\nGitHub Secrets에 VITE_OPENAI_API_KEY를 추가해주세요.");
      return;
    }
    setProcessing(rec.id);
    setNotice(`${rec.student_name} 녹음 분석 중…`);
    try {
      // 1. status → transcribing
      await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`, {
        method: "PATCH",
        headers: { ...SB_H, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "transcribing" }),
      });

      // 2. Signed URL 가져오기
      const signedUrl = await getSignedUrl(rec.audio_url);

      // 3. Whisper 변환
      setNotice(`${rec.student_name} — Whisper 텍스트 변환 중…`);
      const transcript = await transcribeWithWhisper(signedUrl);

      // 4. GPT 분석
      setNotice(`${rec.student_name} — GPT 수업 분석 중…`);
      const { analysis, keywords } = await analyzeWithGPT(transcript, rec.student_name);

      // 5. DB 저장
      await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`, {
        method: "PATCH",
        headers: { ...SB_H, "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, analysis, keywords, status: "done" }),
      });

      setNotice(`✅ ${rec.student_name} 분석 완료!`);
      setTimeout(() => setNotice(""), 4000);
      await loadAll();
    } catch(e) {
      await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`, {
        method: "PATCH",
        headers: { ...SB_H, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "error" }),
      });
      setNotice("분석 실패: " + (e as Error).message);
      setTimeout(() => setNotice(""), 5000);
    }
    setProcessing(null);
  }

  function formatTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  const active = roster.filter(r => (r.studentStatus ?? "active") !== "withdrawn");
  const filtered = recordings.filter(r => !selected || r.student_code === selected);
  const pendingCount = recordings.filter(r => r.status === "uploaded").length;

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div>
          <h2 style={{ margin:0, color:"#0891b2" }}>🎙 수업 녹음 분석</h2>
          {pendingCount > 0 && (
            <p style={{ fontSize:12, color:"#d97706", fontWeight:600, margin:"4px 0 0" }}>
              ⏳ 분석 대기 {pendingCount}건
            </p>
          )}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select value={selected} onChange={e => setSelected(e.target.value)}
            style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
            <option value="">전체 학생</option>
            {active.map(r => <option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
          </select>
          <button onClick={loadAll}
            style={{ padding:"6px 12px", borderRadius:8, border:"1px solid #e2e8f0",
              background:"#fff", fontSize:13, cursor:"pointer" }}>
            🔄 새로고침
          </button>
        </div>
      </div>

      {notice && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:12,
          background: notice.startsWith("✅") ? "#f0fdf4" : "#fef3c7",
          border: `1px solid ${notice.startsWith("✅") ? "#86efac" : "#fde68a"}`,
          color: notice.startsWith("✅") ? "#166534" : "#92400e", fontWeight:600, fontSize:13 }}>
          {notice}
        </div>
      )}

      {/* OpenAI Key 경고 */}
      {!hasOpenAI && (
        <div style={{ padding:"12px 16px", background:"#fef3c7", borderRadius:10,
          border:"1px solid #fde68a", marginBottom:16 }}>
          <p style={{ fontSize:13, color:"#92400e", fontWeight:600, margin:0 }}>
            ⚠️ OpenAI API Key 미설정
          </p>
          <p style={{ fontSize:12, color:"#92400e", margin:"4px 0 0" }}>
            GitHub Secrets에 <code>VITE_OPENAI_API_KEY</code>를 추가해야 Whisper/GPT 분석이 가능합니다.
          </p>
        </div>
      )}

      {/* 녹음 목록 */}
      {loading ? (
        <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>로딩 중…</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
          <p style={{ fontSize:32, marginBottom:8 }}>🎙</p>
          <p>학생이 녹음한 파일이 없습니다.</p>
          <p style={{ fontSize:12 }}>학생 앱에서 수업 녹음 버튼을 누르면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {filtered.map(rec => (
            <div key={rec.id} style={{ border:`1.5px solid ${
              rec.status==="done" ? "#d1fae5" :
              rec.status==="error" ? "#fca5a5" : "#e2e8f0"}`,
              borderRadius:12, overflow:"hidden" }}>
              {/* 카드 헤더 */}
              <div style={{ padding:"10px 14px",
                background: rec.status==="done"?"#f0fdf4":rec.status==="error"?"#fff5f5":"#f8fafc",
                borderBottom:"1px solid #e2e8f0",
                display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:22 }}>🎙</span>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>
                      {rec.student_name}
                    </div>
                    <div style={{ fontSize:11, color:"#94a3b8" }}>
                      {new Date(rec.recorded_at).toLocaleDateString("ko-KR")} &nbsp;
                      {new Date(rec.recorded_at).toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit"})} &nbsp;
                      ({formatTime(rec.duration_sec)})
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:8, fontWeight:600,
                    background: rec.status==="done"?"#d1fae5":rec.status==="transcribing"?"#fef3c7":rec.status==="error"?"#fee2e2":"#f1f5f9",
                    color: rec.status==="done"?"#059669":rec.status==="transcribing"?"#d97706":rec.status==="error"?"#dc2626":"#64748b" }}>
                    {rec.status==="done"?"✅ 분석완료":rec.status==="transcribing"?"⏳ 분석중":rec.status==="error"?"❌ 오류":"📤 대기"}
                  </span>
                  {rec.status === "uploaded" && (
                    <button onClick={() => processRecording(rec)}
                      disabled={processing === rec.id}
                      style={{ padding:"5px 12px", borderRadius:7, border:"none",
                        background: processing===rec.id?"#e2e8f0":"#0891b2",
                        color: processing===rec.id?"#94a3b8":"#fff",
                        fontWeight:600, fontSize:12, cursor: processing===rec.id?"not-allowed":"pointer" }}>
                      {processing===rec.id ? "분석 중…" : "🔍 Whisper 분석"}
                    </button>
                  )}
                  {rec.status === "error" && (
                    <button onClick={() => {
                      fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`,
                        { method:"PATCH", headers:{...SB_H,"Content-Type":"application/json"},
                          body:JSON.stringify({status:"uploaded"}) }).then(() => loadAll());
                    }} style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #e2e8f0",
                      background:"#fff", fontSize:12, cursor:"pointer" }}>재시도</button>
                  )}
                  <button onClick={() => setExpandId(expandId===rec.id?null:rec.id)}
                    style={{ padding:"5px 10px", borderRadius:7, border:"1px solid #e2e8f0",
                      background:"#fff", fontSize:12, cursor:"pointer" }}>
                    {expandId===rec.id?"▲":"▼"}
                  </button>
                </div>
              </div>

              {/* 분석 내용 */}
              {expandId === rec.id && rec.status === "done" && (
                <div style={{ padding:"14px 16px" }}>
                  {/* 키워드 */}
                  {rec.keywords?.length > 0 && (
                    <div style={{ marginBottom:12, display:"flex", flexWrap:"wrap", gap:5 }}>
                      {rec.keywords.map(k => (
                        <span key={k} style={{ fontSize:12, padding:"3px 10px", borderRadius:10,
                          background:"#dbeafe", color:"#1e40af", fontWeight:600 }}>{k}</span>
                      ))}
                    </div>
                  )}
                  {/* 텍스트 */}
                  {rec.transcript && (
                    <div style={{ marginBottom:14 }}>
                      <p style={{ fontSize:11, fontWeight:700, color:"#94a3b8", marginBottom:6 }}>
                        📝 Whisper 변환 텍스트
                      </p>
                      <div style={{ background:"#f8fafc", borderRadius:8, padding:"10px 12px",
                        fontSize:12, color:"#374151", lineHeight:1.8, maxHeight:150, overflowY:"auto" }}>
                        {rec.transcript}
                      </div>
                    </div>
                  )}
                  {/* GPT 분석 */}
                  {rec.analysis && (
                    <div>
                      <p style={{ fontSize:11, fontWeight:700, color:"#94a3b8", marginBottom:6 }}>
                        🔍 GPT 수업 분석
                      </p>
                      <pre style={{ background:"#f0fdf4", borderRadius:8, padding:"10px 12px",
                        fontSize:12, color:"#166534", lineHeight:1.8,
                        whiteSpace:"pre-wrap", fontFamily:"inherit", margin:0 }}>
                        {rec.analysis}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

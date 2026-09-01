import { useEffect, useRef, useState, useMemo } from "react";
import { Mic, Square, RotateCcw, RefreshCw, ChevronDown, ChevronUp, Upload, CheckCircle, XCircle, Loader, Brain, FileText } from "lucide-react";
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
    { method:"POST", headers:{...SB_H,"Content-Type":"application/json"},
      body: JSON.stringify({ expiresIn: 3600 }) }
  );
  const data = await res.json();
  return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
}

async function transcribeAudio(audioBlob: Blob): Promise<string> {
  const form = new FormData();
  // 파일 타입에 맞는 확장자로 Whisper 전송
  const getWhisperExt = (type: string) => {
    if (type.includes("mp4")) return "mp4";
    if (type.includes("webm")) return "webm";
    if (type.includes("ogg")) return "ogg";
    return "mp4";
  };
  const whisperExt = getWhisperExt(audioBlob.type);
  form.append("file", audioBlob, `recording.${whisperExt}`);
  form.append("model", "whisper-1");
  form.append("language", "ko");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method:"POST", headers:{ "Authorization": `Bearer ${OPENAI_KEY}` }, body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).text;
}

async function analyzeLesson(transcript: string, studentName: string): Promise<{analysis:string;keywords:string[]}> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${OPENAI_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      messages:[
        { role:"system", content:`당신은 수능 영어 전문 강사의 수업 분석 보조 AI입니다.
수업 녹음 텍스트를 분석하여 다음 형식으로 작성하세요:

【이해도 분석】
• 학생이 이해한 개념 / 이해하지 못한 부분

【반응 및 참여도】
• 질문 빈도, 반응 속도, 집중도

【취약 영역】
• 반복적으로 틀리거나 막히는 유형

【강점】
• 잘 따라오는 영역

【다음 수업 지도 방향】
• 구체적인 지도 제안 (유형별)

전문적이고 간결하게 작성하세요.` },
        { role:"user", content:`${studentName} 학생 수업 녹음입니다:\n\n${transcript}` }
      ], max_tokens:800,
    })
  });
  if (!res.ok) throw new Error(await res.text());
  const analysis = (await res.json()).choices[0].message.content;

  // 키워드 추출
  const kRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{ "Authorization":`Bearer ${OPENAI_KEY}`, "Content-Type":"application/json" },
    body: JSON.stringify({
      model:"gpt-4o-mini",
      messages:[{ role:"user", content:`다음 수업 내용에서 핵심 키워드 5개를 JSON 배열로만 응답하세요. 예: ["빈칸추론","어휘","독해전략"]\n\n${transcript}` }],
      max_tokens:80,
    })
  });
  let keywords: string[] = [];
  try {
    const txt = (await kRes.json()).choices[0].message.content;
    const m = txt.match(/\[.*?\]/s);
    if (m) keywords = JSON.parse(m[0]);
  } catch { }
  return { analysis, keywords };
}

export default function RecordingPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  // 녹음 상태
  const [selectedStudent, setSelectedStudent] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<string|null>(null);
  const [notice, setNotice] = useState("");
  const [filterStudent, setFilterStudent] = useState("");
  const [expandId, setExpandId] = useState<string|null>(null);

  const mediaRef = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    loadRecordings();
  }, []);

  async function loadRecordings() {
    setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/lesson_recordings?order=recorded_at.desc`,
        { headers: SB_H }
      );
      setRecordings(Array.isArray(await res.json()) ? await res.clone().json() : []);
    } catch {}
    setLoading(false);
  }

  async function startRecording() {
    if (!selectedStudent) { setNotice("학생을 먼저 선택해주세요."); return; }
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // iOS Safari: audio/mp4, Android Chrome: audio/webm, Firefox: audio/ogg
      const SUPPORTED_MIMES = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        "",  // 브라우저 기본값
      ];
      const mime = SUPPORTED_MIMES.find(m => !m || MediaRecorder.isTypeSupported(m)) ?? "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(1000);
      mediaRef.current = mr;
      startRef.current = Date.now();
      setRecording(true); setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now()-startRef.current)/1000)), 1000);
    } catch(e) {
      const errMsg = (e as Error).message;
      if (errMsg.includes("NotAllowed") || errMsg.includes("Permission") || errMsg.includes("denied")) {
        setNotice("마이크 권한이 필요합니다.\n\niPhone: 설정 → Safari → 마이크 → 허용\nAndroid: 브라우저 주소창 옆 자물쇠 → 마이크 허용");
      } else if (errMsg.includes("NotFound") || errMsg.includes("DevicesNotFound")) {
        setNotice("마이크를 찾을 수 없습니다. 기기에 마이크가 연결되어 있는지 확인해주세요.");
      } else {
        setNotice("녹음 시작 실패: " + errMsg);
      }
    }
  }

  async function stopRecording() {
    if (!mediaRef.current) return;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    const duration = Math.floor((Date.now()-startRef.current)/1000);
    mediaRef.current.stop();
    mediaRef.current.stream.getTracks().forEach(t => t.stop());
    await new Promise<void>(resolve => { mediaRef.current!.onstop = () => resolve(); });
    const blob = new Blob(chunksRef.current, { type: mediaRef.current.mimeType });
    await uploadAndAnalyze(blob, duration);
  }

  async function uploadAndAnalyze(blob: Blob, duration: number) {
    const student = roster.find(r => r.studentCode === selectedStudent);
    if (!student) return;
    setUploading(true);
    setNotice("업로드 중…");
    try {
      // 파일 확장자 자동 결정
      const getExt = (type: string) => {
        if (type.includes("mp4")) return "mp4";
        if (type.includes("webm")) return "webm";
        if (type.includes("ogg")) return "ogg";
        if (type.includes("wav")) return "wav";
        return "mp4";  // iOS 기본값
      };
      const ext = getExt(blob.type || mime);
      const path = `${selectedStudent}/${Date.now()}.${ext}`;

      // 1. Storage 업로드
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/lesson-recordings/${path}`,
        { method:"POST", headers: SB_H, body: blob }
      );
      if (!upRes.ok) throw new Error("업로드 실패");

      // 2. DB 저장
      const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings`, {
        method:"POST",
        headers:{ ...SB_H, "Content-Type":"application/json", "Prefer":"return=representation" },
        body: JSON.stringify({
          student_code: selectedStudent, student_name: student.name,
          audio_url: path, duration_sec: duration, status:"transcribing",
        }),
      });
      const [rec] = await dbRes.json();

      // 3. Whisper 변환 (즉시 실행)
      setNotice("🎙 Whisper 텍스트 변환 중…");
      const signedUrl = await getSignedUrl(path);
      const transcript = await transcribeAudio(blob); // blob 직접 사용

      // 4. GPT 분석
      setNotice("GPT 수업 분석 중…");
      const { analysis, keywords } = await analyzeLesson(transcript, student.name);

      // 5. 결과 저장
      await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`, {
        method:"PATCH",
        headers:{ ...SB_H, "Content-Type":"application/json" },
        body: JSON.stringify({ transcript, analysis, keywords, status:"done" }),
      });

      setNotice(`${student.name} 수업 분석 완료!`);
      setTimeout(() => setNotice(""), 5000);
      await loadRecordings();
    } catch(e) {
      setNotice("실패: " + (e as Error).message);
    }
    setUploading(false);
  }

  async function reAnalyze(rec: Recording) {
    setProcessing(rec.id);
    setNotice(`${rec.student_name} 재분석 중…`);
    try {
      const signedUrl = await getSignedUrl(rec.audio_url);
      const audioRes = await fetch(signedUrl);
      const blob = await audioRes.blob();
      const transcript = await transcribeAudio(blob);
      const { analysis, keywords } = await analyzeLesson(transcript, rec.student_name);
      await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`, {
        method:"PATCH",
        headers:{ ...SB_H, "Content-Type":"application/json" },
        body: JSON.stringify({ transcript, analysis, keywords, status:"done" }),
      });
      setNotice(`${rec.student_name} 재분석 완료`);
      setTimeout(() => setNotice(""), 4000);
      await loadRecordings();
    } catch(e) { setNotice("재분석 실패: " + (e as Error).message); }
    setProcessing(null);
  }

  function fmt(sec: number) {
    return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
  }

  const active = roster.filter(r => (r.studentStatus??"active") !== "withdrawn");
  const filtered = recordings.filter(r => !filterStudent || r.student_code === filterStudent);

  return (
    <div className="card">
      <h2 style={{ margin:"0 0 16px", color:"#0891b2" }}>수업 녹음 & AI 분석</h2>

      {notice && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:14, fontWeight:600, fontSize:13,
          background: notice.startsWith("✅")?"#f0fdf4":"#f0f9ff",
          border:`1px solid ${notice.startsWith("✅")?"#86efac":"#7dd3fc"}`,
          color: notice.startsWith("✅")?"#166534":"#0369a1" }}>
          {notice}
        </div>
      )}

      {/* 녹음 패널 */}
      <div style={{ border:"1.5px solid #e0f2fe", borderRadius:14, padding:20, marginBottom:24,
        background:"#f0f9ff" }}>
        <h3 style={{ fontSize:14, fontWeight:700, color:"#0369a1", marginBottom:14 }}>
          학생 선택 후 수업 녹음
        </h3>

        {/* 학생 선택 */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:12, fontWeight:600, color:"#475569", display:"block", marginBottom:6 }}>
            녹음할 학생
          </label>
          <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
            disabled={recording || uploading}
            style={{ width:"100%", padding:"14px 12px", borderRadius:10, border:"1.5px solid #7dd3fc",
              fontSize:16, fontWeight:600, background:"#fff", touchAction:"manipulation" }}>
            <option value="">-- 학생 선택 --</option>
            {active.map(r => (
              <option key={r.studentCode} value={r.studentCode}>
                {r.name} ({r.school} {r.grade}학년)
              </option>
            ))}
          </select>
        </div>

        {/* 녹음 버튼 */}
        <div style={{ display:"flex", alignItems:"center", gap:20, flexWrap:"wrap" }}>
          {!recording ? (
            <button onClick={startRecording}
              disabled={!selectedStudent || uploading}
              style={{ display:"flex", alignItems:"center", gap:10,
                padding:"14px 28px", borderRadius:50, border:"none",
                background: !selectedStudent || uploading ? "#e2e8f0" : "#0891b2",
                color: !selectedStudent || uploading ? "#94a3b8" : "#fff",
                fontWeight:700, fontSize:15, cursor: !selectedStudent||uploading?"not-allowed":"pointer",
                boxShadow: selectedStudent&&!uploading ? "0 4px 20px rgba(8,145,178,0.4)" : "none" }}>
              녹음 시작
            </button>
          ) : (
            <button onClick={stopRecording}
              style={{ display:"flex", alignItems:"center", gap:10,
                padding:"14px 28px", borderRadius:50, border:"none",
                background:"#ef4444", color:"#fff", fontWeight:700, fontSize:15, cursor:"pointer",
                boxShadow:"0 4px 20px rgba(239,68,68,0.5)",
                animation:"pulse 1.2s infinite" }}>
              녹음 중지
            </button>
          )}
          {recording && (
            <div style={{ fontSize:40, fontWeight:700, color:"#ef4444",
              fontVariantNumeric:"tabular-nums", minWidth:100, textAlign:"center" }}>
              {fmt(elapsed)}
            </div>
          )}
          {uploading && (
            <div style={{ fontSize:13, color:"#0891b2", fontWeight:600 }}>
              ⏳ {notice || "처리 중…"}
            </div>
          )}
        </div>

        {selectedStudent && !recording && !uploading && (
          <p style={{ fontSize:12, color:"#64748b", marginTop:10 }}>
            <strong>{roster.find(r=>r.studentCode===selectedStudent)?.name}</strong> 학생 선택됨
            — 녹음 후 자동으로 Whisper + GPT 분석이 진행됩니다.
          </p>
        )}
      </div>

      {/* 녹음 이력 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12, flexWrap:"wrap", gap:8 }}>
        <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", margin:0 }}>
          수업 녹음 이력
        </h3>
        <div style={{ display:"flex", gap:8 }}>
          <select value={filterStudent} onChange={e => setFilterStudent(e.target.value)}
            style={{ padding:"5px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
            <option value="">전체 학생</option>
            {active.map(r => <option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
          </select>
          <button onClick={loadRecordings}
            style={{ padding:"5px 10px", borderRadius:8, border:"1px solid #e2e8f0",
              background:"#fff", fontSize:12, cursor:"pointer" }}></button>
        </div>
      </div>

      {loading ? (
        <p style={{ color:"#94a3b8", textAlign:"center", padding:"24px 0" }}>로딩 중…</p>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:"center", padding:"30px 20px", color:"#94a3b8" }}>
          <p style={{ fontSize:28 }}>🎙</p>
          <p>녹음 이력이 없습니다.</p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {filtered.map(rec => (
            <div key={rec.id} style={{ border:`1.5px solid ${
              rec.status==="done"?"#d1fae5":rec.status==="error"?"#fca5a5":"#e2e8f0"}`,
              borderRadius:12, overflow:"hidden" }}>
              {/* 카드 헤더 */}
              <div style={{ padding:"10px 14px",
                background:rec.status==="done"?"#f0fdf4":rec.status==="error"?"#fff5f5":"#f8fafc",
                borderBottom:"1px solid #f1f5f9",
                display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20 }}></span>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>{rec.student_name}</div>
                    <div style={{ fontSize:11, color:"#94a3b8" }}>
                      {new Date(rec.recorded_at).toLocaleDateString("ko-KR")} &nbsp;
                      {new Date(rec.recorded_at).toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit"})} &nbsp;
                      ({fmt(rec.duration_sec)})
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                  <span style={{ fontSize:11, padding:"2px 8px", borderRadius:8, fontWeight:600,
                    background:rec.status==="done"?"#d1fae5":rec.status==="transcribing"?"#fef3c7":rec.status==="error"?"#fee2e2":"#f1f5f9",
                    color:rec.status==="done"?"#059669":rec.status==="transcribing"?"#d97706":rec.status==="error"?"#dc2626":"#64748b" }}>
                    {rec.status==="done"?"완료":rec.status==="transcribing"?"분석중":rec.status==="error"?"오류":"대기"}
                  </span>
                  {rec.status==="done" && (
                    <button onClick={() => reAnalyze(rec)} disabled={processing===rec.id}
                      style={{ padding:"4px 10px", borderRadius:7, border:"1px solid #e2e8f0",
                        background:"#fff", fontSize:11, cursor:"pointer" }}>
                      {processing===rec.id?"…":"재분석"}
                    </button>
                  )}
                  <button onClick={() => setExpandId(expandId===rec.id?null:rec.id)}
                    style={{ padding:"4px 10px", borderRadius:7, border:"1px solid #e2e8f0",
                      background:"#fff", fontSize:12, cursor:"pointer" }}>
                    {expandId===rec.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                  </button>
                </div>
              </div>

              {/* 분석 내용 */}
              {expandId===rec.id && (
                <div style={{ padding:"14px 16px" }}>
                  {rec.keywords?.length > 0 && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:12 }}>
                      {rec.keywords.map(k => (
                        <span key={k} style={{ fontSize:12, padding:"3px 10px", borderRadius:10,
                          background:"#dbeafe", color:"#1e40af", fontWeight:600 }}>{k}</span>
                      ))}
                    </div>
                  )}
                  {rec.transcript && (
                    <div style={{ marginBottom:14 }}>
                      <p style={{ fontSize:11, fontWeight:700, color:"#94a3b8", marginBottom:6 }}>
                        Whisper 변환 텍스트
                      </p>
                      <div style={{ background:"#f8fafc", borderRadius:8, padding:"10px 12px",
                        fontSize:12, color:"#374151", lineHeight:1.8, maxHeight:160, overflowY:"auto" }}>
                        {rec.transcript}
                      </div>
                    </div>
                  )}
                  {rec.analysis && (
                    <div>
                      <p style={{ fontSize:11, fontWeight:700, color:"#94a3b8", marginBottom:6 }}>
                        GPT 수업 분석
                      </p>
                      <pre style={{ background:"#f0fdf4", borderRadius:8, padding:"10px 12px",
                        fontSize:12, color:"#166534", lineHeight:1.8,
                        whiteSpace:"pre-wrap", fontFamily:"inherit", margin:0 }}>
                        {rec.analysis}
                      </pre>
                    </div>
                  )}
                  {rec.status==="transcribing" && (
                    <p style={{ color:"#d97706", fontSize:13, textAlign:"center", padding:"10px 0" }}>
                      ⏳ 분석 중입니다…
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%,100% { transform:scale(1); }
          50% { transform:scale(1.04); }
        }
      `}</style>
    </div>
  );
}

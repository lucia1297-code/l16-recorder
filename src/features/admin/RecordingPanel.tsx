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
  if (!res.ok) { const t = await res.text().catch(() => `HTTP ${res.status}`); throw new Error(t.slice(0,200)); }
  return (await res.json()).text;
}

async function analyzeLesson(transcript: string, studentName: string): Promise<{analysis:string;keywords:string[]}> {
  if (!OPENAI_KEY) throw new Error("OpenAI API 키 미설정");
  if (!transcript.trim()) throw new Error("전사 텍스트가 비어있습니다.");

  // 텍스트가 너무 길면 앞 8000자만 사용 (토큰 제한)
  const trimmed = transcript.length > 8000 ? transcript.slice(0, 8000) + "\n...(이하 생략)" : transcript;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2분 타임아웃
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: 1500,
        messages: [
          { role: "system", content: `당신은 수능 영어 전문 강사(30년 경력)의 수업 분석 보조 AI입니다.
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
          { role: "user", content: `${studentName} 학생 수업 녹음입니다:

${trimmed}` }
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      throw new Error(`GPT API 오류 (${res.status}): ${errText.slice(0, 200)}`);
    }
    const json = await res.json();
    const analysis = json.choices?.[0]?.message?.content ?? "분석 결과를 가져오지 못했습니다.";
    // 키워드 추출 (분석 텍스트에서 【】 안 제목들)
    const keywords = (analysis.match(/【([^】]+)】/g) ?? [])
      .map((k: string) => k.replace(/【|】/g, ""));
    return { analysis, keywords };
  } catch(e: any) {
    if (e.name === "AbortError") throw new Error("GPT 분석 시간 초과 (2분).");
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function RecordingPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  // 녹음 상태
  const [selectedStudent, setSelectedStudent] = useState("");
  const [recording, setRecording] = useState(false);
  const [elapsed,   setElapsed]   = useState(0);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<string|null>(null);
  const [notice, setNotice] = useState("");
  const [filterStudent, setFilterStudent] = useState("");
  const [expandId, setExpandId] = useState<string|null>(null);

  const mediaRef  = useRef<MediaRecorder|null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef  = useRef<ReturnType<typeof setInterval>|null>(null);
  const startRef  = useRef(0);

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
      const rdata = await res.json();
      setRecordings(Array.isArray(rdata) ? rdata : []);
    } catch {}
    setLoading(false);
  }

  async function startRecording() {
    if (!selectedStudent) { setNotice("학생을 먼저 선택해주세요."); return; }
    setNotice("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // iOS Safari: audio/mp4  /  Android Chrome: audio/webm
      const SUPPORTED_MIMES = [
        "audio/webm;codecs=opus", "audio/webm",
        "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg", "",
      ];
      const mime = SUPPORTED_MIMES.find(m => !m || MediaRecorder.isTypeSupported(m)) ?? "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(1000);
      mediaRef.current = mr;
      startRef.current = Date.now();
      setRecording(true); setElapsed(0);
      timerRef.current = setInterval(() =>
        setElapsed(Math.floor((Date.now()-startRef.current)/1000)), 1000);

      // 갤럭시 백그라운드 유지 힌트
      // MediaSession API — 잠금화면에 "녹음 중" 표시 + 백그라운드 오디오 유지
      const currentStudent = roster.find(r => r.studentCode === selectedStudent);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "수업 녹음 중",
          artist: "L16 민수쌤",
          album: currentStudent?.name ? `${currentStudent.name} 수업` : "수업",
        });
        navigator.mediaSession.setActionHandler("stop", () => stopRecording());
      }
      // 무음 오디오 컨텍스트 — 갤럭시에서 오디오 세션 유지용
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const oscillator = ctx.createOscillator();
          const gainNode = ctx.createGain();
          gainNode.gain.value = 0.00001; // 사실상 무음
          oscillator.connect(gainNode);
          gainNode.connect(ctx.destination);
          oscillator.start();
          // stopRecording 시 정리를 위해 ref에 보관
          (mediaRef.current as any).__audioCtx = ctx;
          (mediaRef.current as any).__oscillator = oscillator;
        }
      } catch(e) { console.warn("AudioContext 불가:", e); }
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

    // 오디오 컨텍스트 정리
    try {
      (mediaRef.current as any).__oscillator?.stop();
      (mediaRef.current as any).__audioCtx?.close();
    } catch(e) { console.warn("AudioCtx 정리 실패:", e); }

    // MediaSession 초기화
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      try { navigator.mediaSession.setActionHandler("stop", null); } catch { }
    }

    const savedMime = mediaRef.current.mimeType || "audio/webm";
    mediaRef.current.stop();
    mediaRef.current.stream.getTracks().forEach(t => t.stop());
    await new Promise<void>((resolve, reject) => {
      if (!mediaRef.current) { resolve(); return; }
      const timeout = setTimeout(() => resolve(), 5000); // 5초 후 강제 완료
      mediaRef.current.onstop = () => { clearTimeout(timeout); resolve(); };
    });
    const blob = new Blob(chunksRef.current, { type: savedMime });
    await uploadAndAnalyze(blob, duration);
  }

  async function uploadAndAnalyze(blob: Blob, duration: number) {
    const student = roster.find(r => r.studentCode === selectedStudent);
    if (!student) return;
    setUploading(true);

    // ── STEP 1: 파일 크기 및 타입 검증 ──────────────
    const sizeMB = blob.size / 1024 / 1024;
    setNotice(`파일 준비 중… (${sizeMB.toFixed(1)}MB)`);

    if (blob.size === 0) {
      setNotice("오류: 녹음 데이터가 없습니다. 마이크 권한을 확인하고 다시 시도해주세요.");
      setUploading(false); return;
    }

    // blob.type 없으면 갤럭시 기본값으로 보정
    const blobType = blob.type || "audio/webm";
    const fixedBlob = blob.type ? blob : new Blob([blob], { type: blobType });

    const getExt = (type: string) => {
      if (type.includes("mp4"))  return "mp4";
      if (type.includes("webm")) return "webm";
      if (type.includes("ogg"))  return "ogg";
      if (type.includes("wav"))  return "wav";
      return "webm"; // 갤럭시 기본값
    };
    const ext = getExt(blobType);
    const path = `${selectedStudent}/${Date.now()}.${ext}`;

    try {
      // ── STEP 2: Supabase Storage 업로드 ──────────
      setNotice(`업로드 중… (${sizeMB.toFixed(1)}MB)`);
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/lesson-recordings/${path}`,
        { method:"POST", headers: { ...SB_H, "Content-Type": blobType }, body: fixedBlob }
      );
      if (!upRes.ok) {
        const errText = await upRes.text().catch(() => upRes.status.toString());
        throw new Error(`업로드 실패 (${upRes.status}): ${errText.slice(0,100)}`);
      }

      // ── STEP 3: DB 레코드 생성 ───────────────────
      const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings`, {
        method:"POST",
        headers:{ ...SB_H, "Content-Type":"application/json", "Prefer":"return=representation" },
        body: JSON.stringify({
          student_code: selectedStudent, student_name: student.name,
          audio_url: path, duration_sec: duration, status:"transcribing",
        }),
      });
      const dbData = await dbRes.json();
      const rec = Array.isArray(dbData) ? dbData[0] : null;
      if (!rec?.id) throw new Error("DB 저장 실패: 레코드를 생성하지 못했습니다.");

      // ── STEP 4: Whisper 전사 ─────────────────────
      setNotice("Whisper 변환 중… (수업 길이에 따라 1~3분 소요)");
      let transcript = "";
      try {
        transcript = await transcribeAudio(fixedBlob);
      } catch(e: any) {
        // Whisper 실패해도 계속 진행 (status는 partial로)
        console.error("Whisper 실패:", e);
        await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`, {
          method:"PATCH",
          headers:{ ...SB_H, "Content-Type":"application/json" },
          body: JSON.stringify({ status:"whisper_failed", transcript: `오류: ${e?.message}` }),
        });
        setNotice(`업로드 완료. Whisper 변환 실패: ${e?.message ?? "네트워크 오류"}`);
        setUploading(false); loadRecordings(); return;
      }

      // ── STEP 5: GPT 분석 ─────────────────────────
      setNotice("GPT 분석 중…");
      let analysis = ""; let keywords: string[] = [];
      try {
        ({ analysis, keywords } = await analyzeLesson(transcript, student.name));
      } catch(e: any) {
        console.error("GPT 분석 실패:", e);
        analysis = `분석 실패: ${e?.message ?? "오류"}`;
      }

      // ── STEP 6: 결과 저장 ────────────────────────
      await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${rec.id}`, {
        method:"PATCH",
        headers:{ ...SB_H, "Content-Type":"application/json" },
        body: JSON.stringify({ transcript, analysis, keywords, status:"done" }),
      });

      setNotice(`✅ ${student.name} 수업 분석 완료!`);
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
      if (!audioRes.ok) throw new Error(`오디오 다운로드 실패 (${audioRes.status})`);
      const blob = await audioRes.blob();
      if (blob.size === 0) throw new Error("오디오 파일이 비어있습니다.");
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
            <>
              <div style={{ fontSize:40, fontWeight:800, color:"#ef4444",
                fontVariantNumeric:"tabular-nums", minWidth:100, textAlign:"center",
                letterSpacing:2 }}>
                {fmt(elapsed)}
              </div>
              <div style={{ fontSize:11, color:"#64748b", textAlign:"center",
                marginTop:4, lineHeight:1.6 }}>
                녹음 중 — 다른 앱 사용 후 돌아오려면<br/>
                <strong>최근 앱 → L16</strong> 선택
              </div>
            </>
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

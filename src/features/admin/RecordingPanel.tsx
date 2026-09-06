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
  status: "uploaded" | "transcribing" | "done" | "error" | "whisper_failed";
}

async function getSignedUrl(path: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/lesson-recordings/${path}`,
    { method:"POST", headers:{...SB_H,"Content-Type":"application/json"},
      body: JSON.stringify({ expiresIn: 3600 }) }
  );
  if (!res.ok) throw new Error(`서명 URL 생성 실패 (${res.status})`);
  const data = await res.json().catch(() => ({}));
  if (!data.signedURL) throw new Error("서명 URL 없음");
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

  const mediaRef   = useRef<MediaRecorder|null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const timerRef   = useRef<ReturnType<typeof setInterval>|null>(null);
  const startRef   = useRef(0);
  const mountedRef = useRef(true); // 언마운트 후 setState 방지

  useEffect(() => {
    mountedRef.current = true;
    rosterStore.listRoster().then(r => { if (mountedRef.current) setRoster(r); });
    loadRecordings();
    return () => {
      mountedRef.current = false;
      // 언마운트 시 녹음 정리
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRef.current?.state !== "inactive") {
        try { mediaRef.current?.stop(); } catch { }
      }
    };
  }, []);

  async function loadRecordings() {
    if (mountedRef.current) setLoading(true);
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/lesson_recordings?order=recorded_at.desc`,
        { headers: SB_H }
      ).catch(() => null);

      if (!res) {
        if (mountedRef.current) setNotice("네트워크 오류 — 인터넷 연결을 확인해주세요.");
        return;
      }
      if (res.status === 403 || res.status === 401) {
        if (mountedRef.current) setNotice("접근 권한 오류 (403) — Supabase RLS 정책을 확인해주세요.");
        return;
      }
      if (res.status === 404 || res.status === 406) {
        if (mountedRef.current) setNotice("lesson_recordings 테이블이 없습니다 — Supabase SQL Editor에서 테이블을 생성해주세요.");
        return;
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        if (mountedRef.current) setNotice(`목록 로드 실패 (${res.status}): ${errText.slice(0,80)}`);
        return;
      }
      const rdata = await res.json().catch(() => []);
      if (mountedRef.current) {
        setRecordings(Array.isArray(rdata) ? rdata : []);
        setNotice(""); // 성공 시 오류 메시지 초기화
      }
    } catch(e: any) {
      console.warn("[RecordingPanel] loadRecordings 오류:", e);
      if (mountedRef.current) setNotice("녹음 목록을 불러오지 못했습니다: " + (e?.message ?? "알 수 없는 오류"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
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
    // MediaRecorder state 체크 후 중지
    if (mediaRef.current.state !== "inactive") {
      mediaRef.current.stop();
    }
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
      if (!dbRes.ok) throw new Error(`DB 저장 실패 (${dbRes.status}): ${await dbRes.text().catch(()=>'')}`);
      const dbData = await dbRes.json().catch(() => []);
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

  // 단계 계산
  const stepIndex = (() => {
    if (notice.includes("업로드") || notice.includes("MB)")) return 0;
    if (notice.includes("레코드") || notice.includes("DB")) return 1;
    if (notice.includes("Whisper")) return 2;
    if (notice.includes("GPT")) return 3;
    if (notice.includes("저장")) return 4;
    return uploading ? 0 : -1;
  })();

  const STEPS = [
    { label: "음성 파일 업로드" },
    { label: "DB 레코드 생성" },
    { label: "Whisper AI 전사" },
    { label: "GPT 수업 분석" },
    { label: "분석 결과 저장" },
  ];

  const currentStudent = roster.find(r => r.studentCode === selectedStudent);

  return (
    <div style={{ background:"#0f172a", minHeight:"100vh", paddingBottom:40, color:"#e2e8f0" }}>

      {/* ── 헤더 ── */}
      <div style={{ background:"#0c1a2e", padding:"14px 16px 12px",
        borderBottom:"1px solid #1e3a5f" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
          <div style={{ width:32, height:32, borderRadius:"50%",
            background:"linear-gradient(135deg,#0891b2,#0e7490)",
            display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
            <Mic size={15} color="#fff"/>
          </div>
          <div>
            <h2 style={{ margin:0, fontSize:16, fontWeight:800, color:"#f0f9ff", letterSpacing:"-0.3px" }}>
              수업 녹음 & AI 분석
            </h2>
            <p style={{ margin:0, fontSize:10, color:"#475569" }}>
              Whisper 전사 → GPT-4o-mini → Supabase
            </p>
          </div>
        </div>
        <div style={{ padding:"6px 10px", borderRadius:8,
          background:"rgba(8,145,178,0.1)", border:"1px solid rgba(8,145,178,0.2)",
          fontSize:10, color:"#7dd3fc", lineHeight:1.7 }}>
          갤럭시: 화면 끄고 다른 앱 사용 가능 → 복귀: <strong>최근 앱 → L16</strong>
          &nbsp;|&nbsp; 종료 시 반드시 <strong>[수업 종료]</strong> 버튼
        </div>
      </div>

      <div style={{ padding:"14px 14px 0" }}>

        {/* ── 알림 배너 ── */}
        {notice && !uploading && (
          <div style={{
            padding:"10px 14px", borderRadius:10, marginBottom:14,
            background: notice.startsWith("✅") ? "rgba(5,150,105,0.15)"
                      : notice.startsWith("오류") || notice.startsWith("마이크") ? "rgba(239,68,68,0.15)"
                      : "rgba(8,145,178,0.15)",
            border:`1px solid ${
              notice.startsWith("✅") ? "rgba(5,150,105,0.4)"
            : notice.startsWith("오류") || notice.startsWith("마이크") ? "rgba(239,68,68,0.4)"
            : "rgba(8,145,178,0.4)"}`,
            color: notice.startsWith("✅") ? "#34d399"
                 : notice.startsWith("오류") || notice.startsWith("마이크") ? "#f87171" : "#38bdf8",
            fontSize:12, fontWeight:600, lineHeight:1.6,
          }}>
            {notice}
          </div>
        )}

        {/* ── 녹음 패널 ── */}
        <div style={{ background:"#1e293b", borderRadius:14,
          border:"1px solid #334155", overflow:"hidden", marginBottom:16 }}>

          {/* 상태 표시줄 */}
          <div style={{ padding:"9px 14px", borderBottom:"1px solid #1e3a5f",
            display:"flex", alignItems:"center", gap:8 }}>
            <div style={{
              width:8, height:8, borderRadius:"50%", flexShrink:0,
              background: recording ? "#ef4444" : uploading ? "#f59e0b" : "#22c55e",
              boxShadow: recording ? "0 0 0 4px rgba(239,68,68,0.25)"
                       : uploading ? "0 0 0 3px rgba(245,158,11,0.2)"
                       : "0 0 0 3px rgba(34,197,94,0.2)",
              animation: (recording || uploading) ? "rp-pulse 1s infinite" : "none",
            }}/>
            <span style={{ fontSize:11, fontWeight:700,
              color: recording ? "#ef4444" : uploading ? "#f59e0b" : "#64748b" }}>
              {recording ? "녹음 중" : uploading ? "분석 중" : "대기"}
            </span>
            {recording && (
              <span style={{ marginLeft:"auto", fontSize:24, fontWeight:900,
                color:"#ef4444", fontFamily:"monospace", letterSpacing:2 }}>
                {fmt(elapsed)}
              </span>
            )}
          </div>

          {/* 학생 선택 (녹음/분석 중 아닐 때) */}
          {!recording && !uploading && (
            <div style={{ padding:"12px 14px" }}>
              <label style={{ fontSize:10, fontWeight:700, color:"#64748b",
                display:"block", marginBottom:6, letterSpacing:"0.05em" }}>
                학생 선택
              </label>
              <select value={selectedStudent}
                onChange={e => setSelectedStudent(e.target.value)}
                style={{ width:"100%", padding:"10px 12px", borderRadius:9,
                  border:`1.5px solid ${selectedStudent ? "#0891b2" : "#334155"}`,
                  background:"#0f172a",
                  color: selectedStudent ? "#f0f9ff" : "#475569",
                  fontSize:13, fontWeight:600, outline:"none",
                  boxSizing:"border-box" as const }}>
                <option value="">-- 학생을 선택하세요 --</option>
                {active.map(r => (
                  <option key={r.studentCode} value={r.studentCode}>
                    {r.name}　{r.school} {r.grade}학년
                  </option>
                ))}
              </select>

              {currentStudent && (
                <div style={{ marginTop:10, padding:"8px 10px", borderRadius:8,
                  background:"rgba(8,145,178,0.08)",
                  border:"1px solid rgba(8,145,178,0.2)",
                  display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0,
                    background:"linear-gradient(135deg,#0891b2,#0e7490)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:13, fontWeight:800, color:"#fff" }}>
                    {currentStudent.name[0]}
                  </div>
                  <div>
                    <div style={{ fontSize:12, fontWeight:700, color:"#e2e8f0" }}>
                      {currentStudent.name}
                    </div>
                    <div style={{ fontSize:10, color:"#64748b" }}>
                      {currentStudent.school} {currentStudent.grade}학년
                      {currentStudent.phone ? ` · ${currentStudent.phone}` : ""}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 녹음 중 — 학생 이름 + 진행 바 */}
          {recording && (
            <div style={{ padding:"10px 14px 0" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0,
                  background:"linear-gradient(135deg,#0891b2,#0e7490)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:13, fontWeight:800, color:"#fff" }}>
                  {currentStudent?.name?.[0] ?? "?"}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:"#e2e8f0" }}>
                    {currentStudent?.name ?? "학생"}
                  </div>
                  <div style={{ fontSize:10, color:"#64748b" }}>녹음 진행 중</div>
                </div>
              </div>
              <div style={{ height:3, background:"#1e3a5f", borderRadius:2, marginBottom:10 }}>
                <div style={{ height:"100%", borderRadius:2,
                  background:"linear-gradient(90deg,#ef4444,#f97316)",
                  width:`${Math.min(100,(elapsed/3600)*100+3)}%`,
                  transition:"width 1s linear" }}/>
              </div>
            </div>
          )}

          {/* 분석 단계 */}
          {uploading && (
            <div style={{ padding:"12px 14px", borderTop:"1px solid #1e3a5f" }}>
              <div style={{ fontSize:10, fontWeight:700, color:"#64748b",
                marginBottom:10, letterSpacing:"0.05em" }}>처리 단계</div>
              {STEPS.map((step, i) => {
                const done   = i < stepIndex;
                const active = i === stepIndex;
                return (
                  <div key={step.label} style={{ display:"flex", alignItems:"center",
                    gap:10, marginBottom: i < 4 ? 8 : 0 }}>
                    <div style={{ width:24, height:24, borderRadius:"50%", flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      background: done   ? "rgba(16,185,129,0.2)"
                                : active ? "rgba(8,145,178,0.2)"
                                : "rgba(255,255,255,0.04)",
                      border:`1.5px solid ${done ? "#10b981" : active ? "#0891b2" : "#334155"}` }}>
                      {done   ? <CheckCircle size={12} color="#10b981"/>
                       : active ? <RefreshCw size={11} color="#38bdf8"
                           style={{ animation:"rp-spin 1s linear infinite" }}/>
                       : <Upload size={11} color="#475569"/>}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, fontWeight:600,
                        color: done ? "#10b981" : active ? "#38bdf8" : "#475569" }}>
                        {step.label}
                      </div>
                      {active && (
                        <div style={{ fontSize:9, color:"#64748b", marginTop:1 }}>
                          진행 중…
                        </div>
                      )}
                    </div>
                    {done && (
                      <span style={{ fontSize:10, color:"#10b981", fontWeight:700 }}>
                        완료
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 버튼 */}
          <div style={{ padding:"12px 14px" }}>
            {!recording && !uploading && (
              <button onClick={startRecording}
                disabled={!selectedStudent}
                style={{ width:"100%", padding:"14px", borderRadius:11, border:"none",
                  background: selectedStudent
                    ? "linear-gradient(135deg,#0891b2,#0e7490)" : "#1e293b",
                  color: selectedStudent ? "#fff" : "#475569",
                  fontWeight:800, fontSize:15, cursor: selectedStudent ? "pointer" : "not-allowed",
                  boxShadow: selectedStudent ? "0 4px 18px rgba(8,145,178,0.4)" : "none",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                  letterSpacing:"-0.2px" }}>
                <Mic size={18}/>
                수업 녹음 시작
              </button>
            )}
            {recording && (
              <>
                <button onClick={stopRecording}
                  style={{ width:"100%", padding:"14px", borderRadius:11, border:"none",
                    background:"linear-gradient(135deg,#dc2626,#b91c1c)",
                    color:"#fff", fontWeight:800, fontSize:15, cursor:"pointer",
                    boxShadow:"0 4px 18px rgba(220,38,38,0.4)",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                    animation:"rp-pulse 2s infinite" }}>
                  <Square size={16} fill="#fff"/>
                  수업 종료
                </button>
                <div style={{ fontSize:10, color:"#64748b", textAlign:"center",
                  marginTop:8, lineHeight:1.7 }}>
                  다른 앱 사용 후 돌아오려면&nbsp;
                  <strong style={{ color:"#94a3b8" }}>최근 앱 → L16</strong>
                </div>
              </>
            )}
            {uploading && (
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0" }}>
                <div style={{ width:7, height:7, borderRadius:"50%",
                  background:"#f59e0b", animation:"rp-pulse 1s infinite" }}/>
                <span style={{ fontSize:12, color:"#fbbf24", fontWeight:600 }}>
                  {notice || "분석 중…"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── 이력 헤더 ── */}
        <div style={{ display:"flex", justifyContent:"space-between",
          alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
          <h3 style={{ margin:0, fontSize:13, fontWeight:700, color:"#64748b",
            display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:3, height:16, borderRadius:2,
              background:"#0891b2", display:"inline-block" }}/>
            수업 분석 이력
          </h3>
          <div style={{ display:"flex", gap:8 }}>
            <select value={filterStudent}
              onChange={e => setFilterStudent(e.target.value)}
              style={{ padding:"6px 10px", borderRadius:8,
                border:"1px solid #334155", background:"#1e293b",
                color:"#94a3b8", fontSize:11, outline:"none" }}>
              <option value="">전체 학생</option>
              {active.map(r => (
                <option key={r.studentCode} value={r.studentCode}>{r.name}</option>
              ))}
            </select>
            <button onClick={() => loadRecordings()}
              style={{ width:32, height:32, borderRadius:8,
                border:"1px solid #334155", background:"#1e293b",
                color:"#64748b", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center" }}>
              <RefreshCw size={13}/>
            </button>
          </div>
        </div>

        {/* ── 이력 목록 ── */}
        {loading ? (
          <div style={{ textAlign:"center", padding:"40px 0" }}>
            <RefreshCw size={24} color="#334155"
              style={{ animation:"rp-spin 1s linear infinite", margin:"0 auto 10px", display:"block" }}/>
            <p style={{ color:"#475569", fontSize:12 }}>불러오는 중…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:"44px 20px",
            border:"1px dashed #1e3a5f", borderRadius:14 }}>
            <Mic size={36} color="#1e3a5f" style={{ marginBottom:10, display:"block", margin:"0 auto 10px" }}/>
            <p style={{ color:"#334155", fontSize:13, fontWeight:600 }}>녹음 이력이 없습니다</p>
            <p style={{ color:"#1e3a5f", fontSize:11, marginTop:4 }}>
              위에서 학생을 선택하고 수업을 시작하세요
            </p>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10, paddingBottom:20 }}>
            {filtered.map(rec => (
              <div key={rec.id} style={{ background:"#1e293b", borderRadius:12,
                border:`1px solid ${
                  rec.status==="done" ? "rgba(16,185,129,0.3)"
                : rec.status==="error"||rec.status==="whisper_failed" ? "rgba(239,68,68,0.3)"
                : "#334155"}`,
                overflow:"hidden" }}>

                {/* 카드 헤더 */}
                <div
                  onClick={() => setExpandId(expandId===rec.id ? null : rec.id)}
                  style={{ padding:"10px 14px", cursor:"pointer",
                    background: rec.status==="done" ? "rgba(16,185,129,0.06)"
                              : rec.status==="error" ? "rgba(239,68,68,0.06)" : "transparent",
                    display:"flex", justifyContent:"space-between",
                    alignItems:"center", flexWrap:"wrap", gap:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:9, flexShrink:0,
                      background:`linear-gradient(135deg,${
                        rec.status==="done" ? "#065f46,#047857"
                      : rec.status==="error" ? "#7f1d1d,#991b1b"
                      : "#0c1a2e,#0f2744"})`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:15, fontWeight:800, color:"#fff" }}>
                      {(rec.student_name||"?")[0]}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:"#e2e8f0" }}>
                        {rec.student_name}
                      </div>
                      <div style={{ fontSize:10, color:"#64748b", marginTop:1,
                        display:"flex", gap:8, flexWrap:"wrap" }}>
                        <span>{new Date(rec.recorded_at).toLocaleDateString("ko-KR")}</span>
                        <span>{new Date(rec.recorded_at).toLocaleTimeString("ko-KR",
                          {hour:"2-digit",minute:"2-digit"})}</span>
                        <span>⏱ {fmt(rec.duration_sec)}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:10, padding:"3px 9px", borderRadius:20, fontWeight:700,
                      background: rec.status==="done" ? "rgba(16,185,129,0.15)"
                                : rec.status==="transcribing" ? "rgba(245,158,11,0.15)"
                                : rec.status==="whisper_failed"||rec.status==="error"
                                  ? "rgba(239,68,68,0.15)" : "rgba(100,116,139,0.15)",
                      color: rec.status==="done" ? "#10b981"
                           : rec.status==="transcribing" ? "#f59e0b"
                           : rec.status==="whisper_failed"||rec.status==="error"
                             ? "#ef4444" : "#64748b" }}>
                      {rec.status==="done" ? "✓ 분석완료"
                     : rec.status==="transcribing" ? "전사중…"
                     : rec.status==="whisper_failed" ? "전사실패"
                     : rec.status==="error" ? "오류"
                     : "처리중"}
                    </span>
                    <div style={{ width:26, height:26, borderRadius:7,
                      border:"1px solid #334155", background:"#0f172a",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      color:"#64748b", transition:"transform .2s",
                      transform: expandId===rec.id ? "rotate(180deg)" : "none" }}>
                      <ChevronDown size={13}/>
                    </div>
                  </div>
                </div>

                {/* 펼침 내용 */}
                {expandId===rec.id && (
                  <div style={{ borderTop:"1px solid #1e3a5f" }}>
                    {rec.transcript && (
                      <div style={{ padding:"12px 14px", borderBottom:"1px solid #1e3a5f" }}>
                        <div style={{ fontSize:10, fontWeight:700, color:"#475569",
                          marginBottom:6, display:"flex", alignItems:"center", gap:5 }}>
                          <Mic size={10}/> Whisper 전사 텍스트
                        </div>
                        <div style={{ fontSize:11, color:"#64748b", lineHeight:1.8,
                          background:"#0f172a", padding:"8px 10px", borderRadius:7,
                          maxHeight:110, overflow:"auto", fontFamily:"monospace",
                          whiteSpace:"pre-wrap" as const }}>
                          {rec.transcript}
                        </div>
                      </div>
                    )}
                    {rec.analysis && (
                      <div style={{ padding:"12px 14px", borderBottom:"1px solid #1e3a5f" }}>
                        <div style={{ fontSize:10, fontWeight:700, color:"#475569",
                          marginBottom:6, display:"flex", alignItems:"center", gap:5 }}>
                          <Brain size={10}/> GPT 수업 분석
                        </div>
                        <div style={{ fontSize:11, color:"#94a3b8", lineHeight:1.8,
                          whiteSpace:"pre-wrap" as const }}>
                          {rec.analysis}
                        </div>
                      </div>
                    )}
                    {rec.keywords && rec.keywords.length > 0 && (
                      <div style={{ padding:"10px 14px", borderBottom:"1px solid #1e3a5f",
                        display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                        <span style={{ fontSize:10, color:"#475569", marginRight:2 }}>
                          키워드
                        </span>
                        {rec.keywords.map((kw: string) => (
                          <span key={kw} style={{ fontSize:10, padding:"2px 8px",
                            borderRadius:6, background:"rgba(8,145,178,0.15)",
                            color:"#38bdf8", fontWeight:600 }}>
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                    <div style={{ padding:"10px 14px", display:"flex", gap:8, flexWrap:"wrap" }}>
                      {rec.status !== "done" && (
                        <button onClick={() => reAnalyze(rec)}
                          disabled={processing===rec.id}
                          style={{ display:"flex", alignItems:"center", gap:6,
                            padding:"6px 14px", borderRadius:8, border:"none",
                            background: processing===rec.id
                              ? "#1e293b" : "rgba(8,145,178,0.2)",
                            color: processing===rec.id ? "#475569" : "#38bdf8",
                            fontSize:11, fontWeight:700, cursor:"pointer" }}>
                          <RefreshCw size={11}/>
                          {processing===rec.id ? "재분석 중…" : "재분석"}
                        </button>
                      )}
                      {processing===rec.id && (
                        <span style={{ fontSize:10, color:"#f59e0b", alignSelf:"center" }}>
                          {notice}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes rp-pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes rp-spin  { to{transform:rotate(360deg)} }
        select option { background:#1e293b; color:#e2e8f0; }
      `}</style>
    </div>
  );
}
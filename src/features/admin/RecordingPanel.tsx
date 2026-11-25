import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Mic, Square, RotateCcw, RefreshCw, ChevronDown, ChevronUp, Upload, CheckCircle, XCircle, Loader, Brain, FileText } from "lucide-react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";
import { transcribeRecording } from "../../lib/recordingTranscription";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };
const OPENAI_PROXY = `${SUPABASE_URL}/functions/v1/recording-transcribe`;
const ANALYZE_PROXY = `${SUPABASE_URL}/functions/v1/recording-analyze`;
const MAX_RECORDING_SECONDS = 5 * 60 * 60;
const SEGMENT_MS = 10 * 60 * 1000; // 10분마다 서버에 안전 업로드
const SILENCE_RMS = 0.006;
const MIC_STORAGE_KEY = "l16.recording.mic";
const SUPPORTED_MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg", ""];
const NO_SPEECH_MESSAGE = "음성이 감지되지 않았습니다 — 마이크 선택과 입력 레벨을 확인해주세요.";

/** 새 방식(한 수업 한 기록) 기록은 audio_url에 구간 파일이 모인 폴더("학생/세션/")를 저장한다. */
function isSessionFolder(path: unknown): path is string {
  return typeof path === "string" && path.endsWith("/") && path.split("/").length >= 3;
}

function micErrorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  const text = `${err?.name ?? ""} ${err?.message ?? ""}`;
  if (/NotAllowed|Permission|denied/i.test(text)) {
    return "마이크 권한이 필요합니다.\n\nPC: 주소창 왼쪽 자물쇠(사이트 정보) → 마이크 → 허용 후 새로고침\niPhone: 설정 → Safari → 마이크 → 허용\nAndroid: 주소창 옆 자물쇠 → 마이크 허용";
  }
  if (/NotFound|DevicesNotFound/i.test(text)) return "마이크를 찾을 수 없습니다. PC에 마이크가 연결되어 있는지 확인해주세요.";
  if (/NotReadable|TrackStart/i.test(text)) return "마이크를 다른 프로그램(줌·카톡 통화 등)이 사용 중입니다. 그 프로그램을 닫고 다시 시도해주세요.";
  return "녹음 시작 실패: " + (err?.message ?? String(e));
}

function downloadBlobs(blobs: Blob[], baseName: string) {
  const safe = baseName.replace(/[\\/:*?"<>|]/g, "_");
  blobs.forEach((blob, i) => {
    const ext = (blob.type || "").includes("mp4") ? "mp4" : (blob.type || "").includes("ogg") ? "ogg" : "webm";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${safe}-${String(i + 1).padStart(2, "0")}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}

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
  status: "recording" | "uploaded" | "transcribing" | "done" | "error" | "whisper_failed";
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

async function analyzeLesson(transcript: string, studentName: string): Promise<{analysis:string;keywords:string[]}> {
  if (!transcript.trim()) throw new Error("전사 텍스트가 비어있습니다.");

  // 텍스트가 너무 길면 앞 8000자만 사용 (토큰 제한)
  const trimmed = transcript.length > 8000 ? transcript.slice(0, 8000) + "\n...(이하 생략)" : transcript;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2분 타임아웃
  try {
    const res = await fetch(ANALYZE_PROXY, {
      method: "POST",
      headers: { ...SB_H, "Content-Type": "application/json" },
      body: JSON.stringify({
        studentName,
        transcript: trimmed,
        model: "gpt-4o-mini",
        max_tokens: 3000,
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

전사 내용의 근거를 충분히 인용하여 각 항목을 구체적으로 작성하세요. 학생의 발화·오류·교사의 지도 흐름을 구분하고, 관찰 근거가 없는 내용은 추정하지 마세요. 최소 10개 이상의 구체적인 관찰 문장을 작성하세요.` },
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
    const analysis = json.analysis ?? json.choices?.[0]?.message?.content ?? "분석 결과를 가져오지 못했습니다.";
    // 키워드 추출 (분석 텍스트에서 【】 안 제목들)
    const keywords = (analysis.match(/【([^】]+)】/g) ?? [])
      .map((k: string) => k.replace(/【|】/g, ""));
    return { analysis, keywords: Array.isArray(json.keywords) && json.keywords.length ? json.keywords : keywords };
  } catch(e: any) {
    if (e.name === "AbortError") throw new Error("GPT 분석 시간 초과 (2분).");
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

function cleanTranscriptForAnalysis(text: string): string {
  // Whisper can hallucinate long runs of question numbers in silence. Preserve
  // normal numbers, but replace only an unusually long consecutive number run.
  return text
    .replace(/(?:\b\d{1,3}(?:번)?\s*){20,}/g, "\n[연속 번호 환각 구간 자동 정리]\n")
    .replace(/(?:\s*\b1(?:번)?\b){12,}/g, "\n[반복 숫자 환각 구간 자동 정리]\n")
    .trim();
}

function downloadTranscript(rec: Recording, format: "txt" | "doc") {
  const safeName = rec.student_name.replace(/[\\/:*?"<>|]/g, "_");
  const title = `${rec.student_name} 수업 전사`;
  const text = rec.transcript?.trim() || "전사 내용이 없습니다.";
  const blob = format === "txt"
    ? new Blob(["\uFEFF", `${title}\n\n${text}`], { type: "text/plain;charset=utf-8" })
    : new Blob([`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><pre style="white-space:pre-wrap;font-family:맑은 고딕,Arial">${text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre></body></html>`], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeName}-transcript.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [processResult, setProcessResult] = useState<Record<string,string>>({});
  const [notice, setNotice] = useState("");
  const [filterStudent, setFilterStudent] = useState("");
  const [expandId, setExpandId] = useState<string|null>(null);

  // 마이크 선택 · 입력 레벨
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>(() => localStorage.getItem(MIC_STORAGE_KEY) || "");
  const [level, setLevel] = useState(0);
  const [silentSec, setSilentSec] = useState(0);
  const [testing, setTesting] = useState(false);
  const [segmentInfo, setSegmentInfo] = useState({ uploaded: 0, failed: 0 });
  const [lastSession, setLastSession] = useState<{ name: string; blobs: Blob[] } | null>(null);

  const mediaRef   = useRef<MediaRecorder|null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const streamRef  = useRef<MediaStream|null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  const segmentStartRef = useRef(0);
  const stoppingRef = useRef(false);
  const timerRef   = useRef<ReturnType<typeof setInterval>|null>(null);
  const startRef   = useRef(0);
  const mountedRef = useRef(true); // 언마운트 후 setState 방지
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const sessionIdRef = useRef<string>("");
  const deviceIdRef = useRef<string>(localStorage.getItem("l16.recording.device") || crypto.randomUUID());
  // 한 수업 = 한 기록. 10분 구간은 안전 업로드용이고 전사·분석은 수업 종료 때 한 번.
  const sessionRef = useRef<{ rowId: string; studentCode: string; studentName: string; prevTranscript: string; prevDuration: number } | null>(null);
  const segmentsRef = useRef<Array<{ blob: Blob; path: string; uploaded: Promise<boolean> }>>([]);
  const meterRef = useRef<{ ctx: AudioContext; timer: ReturnType<typeof setInterval>; stream?: MediaStream } | null>(null);
  const lastLoudRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const eqCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const eqRafRef = useRef<number | null>(null);

  useEffect(() => { localStorage.setItem("l16.recording.device", deviceIdRef.current); }, []);


  useEffect(() => {
    mountedRef.current = true;
    rosterStore.listRoster().then(r => { if (mountedRef.current) setRoster(r); });
    loadRecordings();
    void refreshMics();
    const onDeviceChange = () => { void refreshMics(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      mountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      // 언마운트 시 녹음 정리
      if (timerRef.current) clearInterval(timerRef.current);
      if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
      if (mediaRef.current?.state !== "inactive") {
        try { mediaRef.current?.stop(); } catch { }
      }
      stopMeter();
      streamRef.current?.getTracks().forEach(t => t.stop());
      void wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, []);

  useEffect(() => {
    const reacquireWakeLock = async () => {
      if (!recording || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
      try { wakeLockRef.current = await navigator.wakeLock.request("screen"); } catch { /* browser may deny it */ }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void reacquireWakeLock(); };
    document.addEventListener("visibilitychange", onVisibility);
    void reacquireWakeLock();
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [recording]);

  // PC: 녹음 중 탭/창을 닫거나 새로고침하면 경고
  useEffect(() => {
    if (!recording && !uploading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [recording, uploading]);

  async function refreshMics() {
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.();
      const inputs = (devices ?? []).filter(d => d.kind === "audioinput");
      if (mountedRef.current) setMics(inputs);
    } catch { /* 일부 브라우저는 권한 전 목록을 숨긴다 */ }
  }

  function chooseMic(id: string) {
    setMicId(id);
    if (id) localStorage.setItem(MIC_STORAGE_KEY, id); else localStorage.removeItem(MIC_STORAGE_KEY);
  }

  async function openMic(): Promise<MediaStream> {
    const base: MediaTrackConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: micId ? { ...base, deviceId: { exact: micId } } : base });
    } catch (e: any) {
      // 저장해 둔 마이크가 빠졌으면 기본 마이크로 다시 시도
      if (micId && (e?.name === "OverconstrainedError" || e?.name === "NotFoundError")) {
        chooseMic("");
        return navigator.mediaDevices.getUserMedia({ audio: base });
      }
      throw e;
    }
  }

  function startMeter(stream: MediaStream, ownsStream = false) {
    stopMeter();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      const data = new Float32Array(analyser.fftSize);
      lastLoudRef.current = Date.now();
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const lv = Math.min(1, rms * 8);
        if (rms > SILENCE_RMS) lastLoudRef.current = Date.now();
        if (mountedRef.current) {
          setLevel(lv);
          setSilentSec(Math.floor((Date.now() - lastLoudRef.current) / 1000));
        }
      }, 200);
      meterRef.current = { ctx, timer, stream: ownsStream ? stream : undefined };
    } catch (e) { console.warn("입력 레벨 측정 불가:", e); }
  }

  function stopMeter() {
    const m = meterRef.current;
    if (!m) return;
    clearInterval(m.timer);
    void m.ctx.close().catch(() => {});
    m.stream?.getTracks().forEach(t => t.stop());
    meterRef.current = null;
    analyserRef.current = null;
    // EQ 애니메이션은 계속 유지 (시뮬레이션 모드로 전환됨)
    if (mountedRef.current) { setLevel(0); setSilentSec(0); }
  }

  async function toggleMicTest() {
    if (testing) { stopMeter(); setTesting(false); return; }
    try {
      const stream = await openMic();
      await refreshMics(); // 권한을 받은 뒤에야 마이크 이름이 보인다
      startMeter(stream, true);
      setTesting(true);
      setNotice("마이크 테스트 중 — 말을 해 보세요. 막대가 움직이면 정상입니다.");
    } catch (e) { setNotice(micErrorMessage(e)); }
  }

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
      if (mountedRef.current) setRecordings(Array.isArray(rdata) ? rdata : []);
    } catch(e: any) {
      console.warn("[RecordingPanel] loadRecordings 오류:", e);
      if (mountedRef.current) setNotice("녹음 목록을 불러오지 못했습니다: " + (e?.message ?? "알 수 없는 오류"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function patchRow(id: string, body: Record<string, unknown>) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${id}`, {
      method:"PATCH", headers:{ ...SB_H, "Content-Type":"application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`저장 실패 (HTTP ${res.status})`);
  }

  async function startRecording() {
    if (!selectedStudent) { setNotice("학생을 먼저 선택해주세요."); return; }
    const student = roster.find(r => r.studentCode === selectedStudent);
    if (!student) { setNotice("학생 정보를 찾지 못했습니다."); return; }
    setNotice("");
    if (testing) { stopMeter(); setTesting(false); }
    try {
      const stream = await openMic();
      void refreshMics();

      // 최근 3시간 안에 같은 학생의 새 방식 녹음(한 수업 한 기록)이 있으면 같은 기록에 이어 붙인다.
      const recent = await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?student_code=eq.${encodeURIComponent(selectedStudent)}&order=recorded_at.desc&limit=1`, {headers:SB_H}).then(r => r.ok ? r.json() : []).catch(() => []);
      const latest = Array.isArray(recent) ? recent[0] : null;
      const latestAt = latest?.recorded_at ? Date.parse(latest.recorded_at) : 0;
      const canResume = !!latest && latestAt > Date.now() - 3 * 60 * 60 * 1000 && isSessionFolder(latest.audio_url);
      let rowId = "";
      if (canResume) {
        sessionIdRef.current = latest.audio_url.split("/")[1];
        rowId = latest.id;
        await patchRow(rowId, { status: "recording" }).catch(() => {});
        setNotice("최근 수업 기록에 이어서 녹음합니다.");
      } else {
        sessionIdRef.current = crypto.randomUUID();
        const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings`, {
          method:"POST",
          headers:{ ...SB_H, "Content-Type":"application/json", "Prefer":"return=representation" },
          body: JSON.stringify({
            student_code: selectedStudent, student_name: student.name,
            audio_url: `${selectedStudent}/${sessionIdRef.current}/`, duration_sec: 0, status: "recording",
          }),
        });
        if (!dbRes.ok) { stream.getTracks().forEach(t => t.stop()); throw new Error(`DB 기록 생성 실패 (${dbRes.status})`); }
        const rows = await dbRes.json().catch(() => []);
        rowId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : "";
        if (!rowId) { stream.getTracks().forEach(t => t.stop()); throw new Error("DB 기록 생성 실패"); }
      }
      sessionRef.current = {
        rowId, studentCode: selectedStudent, studentName: student.name,
        prevTranscript: canResume ? (latest.transcript ?? "").trim() : "",
        prevDuration: canResume ? (latest.duration_sec ?? 0) : 0,
      };
      segmentsRef.current = [];
      setSegmentInfo({ uploaded: 0, failed: 0 });
      setLastSession(null);

      streamRef.current = stream;
      startRecorder(stream);
      startMeter(stream);
      startRef.current = Date.now();
      stoppingRef.current = false;
      setRecording(true); setElapsed(0);
      timerRef.current = setInterval(() => {
        const seconds = Math.floor((Date.now()-startRef.current)/1000);
        setElapsed(seconds);
        if (seconds >= MAX_RECORDING_SECONDS) {
          setNotice("최대 5시간 녹음에 도달해 자동으로 마무리합니다.");
          void stopRecording();
        }
      }, 1000);

      // MediaSession API — 잠금화면에 "녹음 중" 표시 + 백그라운드 오디오 유지
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: "수업 녹음 중", artist: "L16 민수쌤", album: `${student.name} 수업`,
        });
        navigator.mediaSession.setActionHandler("stop", () => { void stopRecording(); });
      }
    } catch(e) {
      setNotice(micErrorMessage(e));
    }
  }

  function startRecorder(stream: MediaStream) {
    const prev = mediaRef.current?.mimeType;
    const mime = prev || SUPPORTED_MIMES.find(m => !m || MediaRecorder.isTypeSupported(m)) || "";
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    chunksRef.current = [];
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.start(10_000); // 10초마다 데이터를 받아 두어 중간 손실을 줄인다
    mediaRef.current = mr;
    segmentStartRef.current = Date.now();
    segmentTimerRef.current = setTimeout(() => { void rotateSegment(); }, SEGMENT_MS);
  }

  async function finishRecorder(): Promise<Blob> {
    const current = mediaRef.current;
    if (!current) return new Blob();
    const mime = current.mimeType || "audio/webm";
    if (current.state !== "inactive") {
      const stopped = new Promise<void>(resolve => current.addEventListener("stop", () => resolve(), { once:true }));
      current.stop();
      await Promise.race([stopped, new Promise<void>(resolve => setTimeout(resolve, 5000))]);
    }
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    return blob;
  }

  async function rotateSegment() {
    if (!mediaRef.current || mediaRef.current.state === "inactive" || stoppingRef.current) return;
    // 녹음기를 멈췄다 다시 시작해야 구간마다 따로 재생 가능한 파일이 된다.
    const blob = await finishRecorder();
    if (blob.size > 0) queueSegment(blob);
    if (!streamRef.current || stoppingRef.current) return;
    startRecorder(streamRef.current);
  }

  function queueSegment(blob: Blob) {
    const s = sessionRef.current;
    if (!s) return;
    const type = blob.type || "audio/webm";
    const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
    const index = String(segmentsRef.current.length + 1).padStart(3, "0");
    const path = `${s.studentCode}/${sessionIdRef.current}/${Date.now()}-${index}-${deviceIdRef.current.slice(0, 8)}.${ext}`;
    const uploaded = uploadWithRetry(path, blob, type).then(ok => {
      if (mountedRef.current) setSegmentInfo(prev => ok ? { ...prev, uploaded: prev.uploaded + 1 } : { ...prev, failed: prev.failed + 1 });
      return ok;
    });
    segmentsRef.current.push({ blob, path, uploaded });
  }

  async function uploadWithRetry(path: string, blob: Blob, type: string): Promise<boolean> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_URL}/storage/v1/object/lesson-recordings/${path}`, {
          method:"POST", headers: { ...SB_H, "Content-Type": type, "x-upsert": "true" }, body: blob,
        });
        if (res.ok) return true;
      } catch { /* 네트워크 일시 오류 — 재시도 */ }
      await new Promise(r => setTimeout(r, attempt * 3000));
    }
    return false;
  }

  async function stopRecording() {
    if (!mediaRef.current || stoppingRef.current) return;
    stoppingRef.current = true;
    setRecording(false);
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    const duration = Math.floor((Date.now()-startRef.current)/1000);

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      try { navigator.mediaSession.setActionHandler("stop", null); } catch { }
    }

    const blob = await finishRecorder();
    if (blob.size > 0) queueSegment(blob);
    stopMeter();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRef.current = null;
    await finalizeSession(duration);
  }

  async function finalizeSession(duration: number) {
    const s = sessionRef.current;
    const segments = segmentsRef.current;
    if (!s) return;
    setUploading(true);
    const name = s.studentName;
    try {
      setNotice(`업로드 마무리 중… (${segments.length}개 구간)`);
      const results = await Promise.all(segments.map(seg => seg.uploaded));
      const failedBlobs = segments.filter((_, i) => !results[i]).map(seg => seg.blob);
      setLastSession({ name, blobs: segments.map(seg => seg.blob) });
      if (failedBlobs.length) {
        downloadBlobs(failedBlobs, `${name}-업로드실패`);
        setNotice(`업로드 실패 ${failedBlobs.length}개 구간은 PC 다운로드 폴더에 저장했습니다.`);
      }
      const totalDuration = s.prevDuration + duration;
      await patchRow(s.rowId, { duration_sec: totalDuration, status: "transcribing" }).catch(() => {});

      // ── Whisper 전사 (구간별, 무음 구간은 건너뜀) ──
      const texts: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        setNotice(`Whisper 변환 중… (${i + 1}/${segments.length} 구간)`);
        texts.push(await transcribeSegment(segments[i].blob));
      }
      const newText = cleanTranscriptForAnalysis(texts.filter(Boolean).join("\n"));
      const transcript = [s.prevTranscript, newText].filter(Boolean).join("\n");
      if (!transcript) {
        await patchRow(s.rowId, { status: "whisper_failed", transcript: `오류: ${NO_SPEECH_MESSAGE}` });
        setNotice(`업로드 완료. ${NO_SPEECH_MESSAGE}`);
        return;
      }

      // ── GPT 분석 (수업 전체 1회) ──
      setNotice("GPT 분석 중…");
      let analysis = ""; let keywords: string[] = [];
      try {
        ({ analysis, keywords } = await analyzeLesson(transcript, name));
      } catch(e: any) {
        console.error("GPT 분석 실패:", e);
        analysis = `분석 실패: ${e?.message ?? "오류"}`;
      }
      setNotice("분석 결과 저장 중…");
      await patchRow(s.rowId, { transcript, analysis, keywords, status: "done" });
      setNotice(`✅ ${name} 수업 분석 완료!`);
      setTimeout(() => { if (mountedRef.current) setNotice(""); }, 5000);
    } catch(e) {
      setNotice("실패: " + (e as Error).message + " — 녹음 파일은 서버에 남아 있으니 [원본 재전사 후 분석]으로 다시 처리할 수 있습니다.");
    } finally {
      sessionRef.current = null;
      setUploading(false);
      await loadRecordings();
    }
  }

  async function transcribeSegment(blob: Blob): Promise<string> {
    try {
      return await transcribeRecording(blob, "", { onProgress: () => {}, proxyUrl: OPENAI_PROXY, proxyHeaders: SB_H });
    } catch (e: any) {
      if (String(e?.message ?? "").includes("비어있")) return ""; // 무음 구간
      throw e;
    }
  }

  async function listSessionFiles(prefix: string): Promise<string[]> {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/lesson-recordings`, {
      method:"POST", headers:{ ...SB_H, "Content-Type":"application/json" },
      body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`녹음 파일 목록 조회 실패 (${res.status})`);
    const items = await res.json().catch(() => []);
    return (Array.isArray(items) ? items : [])
      .filter((it: any) => it?.name && it.id)
      .map((it: any) => `${prefix}${it.name}`)
      .sort();
  }

  async function reAnalyze(rec: Recording, forceRetranscribe = false) {
    setProcessing(rec.id);
    setProcessResult(prev => ({ ...prev, [rec.id]: `${rec.student_name} 재분석 시작…` }));
    setNotice(`${rec.student_name} 재분석 중…`);
    let stage = "녹음 접근 확인";
    try {
      const existing = rec.transcript?.trim() ?? "";
      let transcript = forceRetranscribe || existing.startsWith("오류:") ? "" : cleanTranscriptForAnalysis(existing);
      if (!transcript) {
        const paths = isSessionFolder(rec.audio_url) ? await listSessionFiles(rec.audio_url) : [rec.audio_url];
        if (!paths.length) throw new Error("서버에 녹음 파일이 없습니다.");
        const texts: string[] = [];
        for (let i = 0; i < paths.length; i++) {
          stage = "녹음 다운로드";
          setNotice(`${rec.student_name} 녹음 다운로드 중… (${i + 1}/${paths.length})`);
          const audioRes = await fetch(await getSignedUrl(paths[i]));
          if (!audioRes.ok) throw new Error(`오디오 다운로드 실패 (${audioRes.status})`);
          const blob = await audioRes.blob();
          if (blob.size === 0) continue;
          stage = "Whisper 전사";
          setNotice(`${rec.student_name} Whisper 변환 중… (${i + 1}/${paths.length} 구간)`);
          texts.push(await transcribeSegment(blob));
        }
        transcript = cleanTranscriptForAnalysis(texts.filter(Boolean).join("\n"));
        if (!transcript) throw new Error(NO_SPEECH_MESSAGE);
      } else {
        setNotice(`${rec.student_name} 기존 전사문으로 GPT 정밀 재분석 중…`);
      }
      stage = "GPT 분석";
      setNotice(`${rec.student_name} GPT 분석 중…`);
      const { analysis, keywords } = await analyzeLesson(transcript, rec.student_name);
      stage = "분석 결과 저장";
      await patchRow(rec.id, { transcript, analysis, keywords, status:"done" });
      setNotice(`${rec.student_name} 재분석 완료`);
      setProcessResult(prev => ({ ...prev, [rec.id]: `${rec.student_name} 재분석 완료` }));
      setTimeout(() => setNotice(""), 4000);
      await loadRecordings();
    } catch(e) {
      const message = `${stage} 실패: ${(e as Error).message}`;
      setNotice(message);
      setProcessResult(prev => ({ ...prev, [rec.id]: message }));
    }
    finally { setProcessing(null); }
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

  // ── 이퀄라이저 canvas 콜백 ─────────────────────────────────────────
  const eqCanvasCallback = useCallback((canvas: HTMLCanvasElement | null) => {
    eqCanvasRef.current = canvas;
    if (!canvas) return;

    const NUM_BARS = 32;
    const peaks = new Float32Array(NUM_BARS).fill(0);
    const peakHold = new Float32Array(NUM_BARS).fill(0); // 피크 홀드 타이머
    const cv: HTMLCanvasElement = canvas; // null 아님을 클로저에서 보장

    function draw() {
      eqRafRef.current = requestAnimationFrame(draw);
      const ctx2d = cv.getContext("2d");
      if (!ctx2d) return;

      const W = cv.width;
      const H = cv.height;
      ctx2d.clearRect(0, 0, W, H);

      // 배경
      ctx2d.fillStyle = "#0a1628";
      ctx2d.fillRect(0, 0, W, H);

      const analyser = analyserRef.current;
      let freqValues: number[];

      if (analyser) {
        // 실제 오디오 데이터
        const buf = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatFrequencyData(buf);
        freqValues = Array.from(buf);
      } else {
        // 마이크 없을 때: 녹음 중이면 시뮬레이션 애니메이션
        const t = Date.now() / 1000;
        freqValues = [];
        for (let i = 0; i < NUM_BARS; i++) {
          // 저음역대가 높고 고음역대로 갈수록 낮아지는 자연스러운 모양
          const base = Math.max(0, 1 - i / NUM_BARS) * 0.6;
          const wave1 = Math.sin(t * 1.3 + i * 0.4) * 0.25;
          const wave2 = Math.sin(t * 2.1 + i * 0.7) * 0.15;
          const wave3 = Math.sin(t * 0.7 + i * 1.1) * 0.10;
          freqValues.push((base + wave1 + wave2 + wave3 + 0.05) * -60);
        }
      }

      // 주파수 빈을 NUM_BARS 개로 압축 (로그 스케일)
      const binCount = analyser ? analyser.frequencyBinCount : NUM_BARS;
      const barW = (W - (NUM_BARS - 1) * 2) / NUM_BARS;

      for (let i = 0; i < NUM_BARS; i++) {
        // 로그 스케일로 빈 범위 계산
        const start = Math.floor(Math.pow(i / NUM_BARS, 1.5) * binCount);
        const end   = Math.floor(Math.pow((i + 1) / NUM_BARS, 1.5) * binCount);

        let maxDb = -140;
        for (let b = start; b <= end && b < freqValues.length; b++) {
          if (freqValues[b] > maxDb) maxDb = freqValues[b];
        }

        // dB → 0~1 정규화 (-100dB ~ -10dB 범위)
        const norm = Math.max(0, Math.min(1, (maxDb + 100) / 90));

        // 피크 홀드
        if (norm > peaks[i]) { peaks[i] = norm; peakHold[i] = 30; }
        else if (peakHold[i] > 0) { peakHold[i]--; }
        else { peaks[i] = Math.max(0, peaks[i] - 0.015); }

        const x = i * (barW + 2);
        const barH = norm * (H - 6);

        // 그라디언트 — 아래(청록)→중간(초록)→위(주황)
        const grad = ctx2d.createLinearGradient(0, H, 0, 0);
        grad.addColorStop(0,   "#0891b2");
        grad.addColorStop(0.5, "#10b981");
        grad.addColorStop(0.85,"#34d399");
        grad.addColorStop(1,   "#f97316");

        ctx2d.fillStyle = grad;
        ctx2d.fillRect(x, H - barH, barW, barH);

        // 피크 라인
        if (peaks[i] > 0.02) {
          const py = H - peaks[i] * (H - 6) - 2;
          ctx2d.fillStyle = peaks[i] > 0.9 ? "#f97316" : "#22d3ee";
          ctx2d.fillRect(x, py, barW, 2);
        }
      }

      // 그리드 라인 (희미하게)
      ctx2d.strokeStyle = "rgba(255,255,255,0.04)";
      ctx2d.lineWidth = 1;
      for (let g = 1; g <= 3; g++) {
        const y = H * g / 4;
        ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(W, y); ctx2d.stroke();
      }
    }

    // 이전 RAF 취소 후 새로 시작
    if (eqRafRef.current) cancelAnimationFrame(eqRafRef.current);
    draw();
  }, []);

  // 컴포넌트 마운트 시 EQ 애니메이션 시작 (항상 실행)
  useEffect(() => {
    if (eqCanvasRef.current && !eqRafRef.current) {
      eqCanvasCallback(eqCanvasRef.current);
    }
    return () => { if (eqRafRef.current) { cancelAnimationFrame(eqRafRef.current); eqRafRef.current = null; } };
  }, [eqCanvasCallback]);

  const levelBar = (
    <div style={{ marginTop:10 }}>
      {/* 이퀄라이저 */}
      <div style={{ position:"relative", borderRadius:8, overflow:"hidden",
        border:"1px solid #1e3a5f", marginBottom:8 }}>
        <canvas
          ref={eqCanvasCallback}
          width={320}
          height={72}
          style={{ width:"100%", height:72, display:"block" }}
        />
        {/* 오버레이 라벨 */}
        <div style={{ position:"absolute", top:4, left:8, fontSize:9,
          color:"rgba(100,116,139,0.8)", letterSpacing:"0.05em", fontWeight:600 }}>
          EQ
        </div>
        <div style={{ position:"absolute", top:4, right:8, fontSize:9,
          color: silentSec >= 15 ? "#f87171" : level > 0.05 ? "#34d399" : "rgba(100,116,139,0.8)",
          fontWeight:700 }}>
          {silentSec >= 15 ? `${silentSec}초째 소리 없음` : level > 0.05 ? "● REC" : "○ 대기"}
        </div>
      </div>
      {/* 레벨 바 (얇게) */}
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#64748b", marginBottom:3 }}>
        <span>입력 레벨</span>
        <span style={{ color: silentSec >= 15 ? "#f87171" : level > 0.05 ? "#34d399" : "#64748b" }}>
          {Math.round(level * 100)}%
        </span>
      </div>
      <div style={{ height:5, borderRadius:3, background:"#0f172a", border:"1px solid #1e3a5f", overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${Math.round(level*100)}%`, transition:"width .15s linear",
          background: level > 0.85 ? "#f97316" : "linear-gradient(90deg,#0891b2,#10b981,#22d3ee)" }}/>
      </div>
      {silentSec >= 15 && (
        <div style={{ marginTop:8, padding:"8px 10px", borderRadius:8, background:"rgba(239,68,68,0.12)",
          border:"1px solid rgba(239,68,68,0.4)", color:"#fca5a5", fontSize:11, lineHeight:1.6 }}>
          ⚠️ 마이크로 소리가 들어오지 않습니다. 마이크 선택, 음소거(Windows 소리 설정) 여부를 확인해주세요.
        </div>
      )}
    </div>
  );

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
          PC: 녹음 중 이 탭을 닫지 마세요(다른 창 사용은 가능) · 갤럭시: 복귀는 <strong>최근 앱 → L16</strong>
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


              <label style={{ fontSize:10, fontWeight:700, color:"#64748b",
                display:"block", margin:"12px 0 6px", letterSpacing:"0.05em" }}>
                마이크 선택
              </label>
              <div style={{ display:"flex", gap:8 }}>
                <select value={micId} onChange={e => chooseMic(e.target.value)}
                  style={{ flex:1, minWidth:0, padding:"10px 12px", borderRadius:9, border:"1.5px solid #334155",
                    background:"#0f172a", color:"#e2e8f0", fontSize:12, outline:"none" }}>
                  <option value="">기본 마이크 (Windows 기본 장치)</option>
                  {mics.filter(m => m.deviceId && m.deviceId !== "default" && m.deviceId !== "communications").map((m, i) => (
                    <option key={m.deviceId} value={m.deviceId}>{m.label || `마이크 ${i + 1}`}</option>
                  ))}
                </select>
                <button onClick={toggleMicTest}
                  style={{ padding:"0 12px", borderRadius:9, border:"1px solid #0891b2",
                    background: testing ? "#0891b2" : "transparent", color: testing ? "#fff" : "#38bdf8",
                    fontSize:11, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                  {testing ? "테스트 끝" : "마이크 테스트"}
                </button>
              </div>
              {mics.length > 0 && mics.every(m => !m.label) && (
                <div style={{ fontSize:10, color:"#64748b", marginTop:6 }}>
                  마이크 이름이 안 보이면 [마이크 테스트]를 한 번 눌러 권한을 허용해주세요.
                </div>
              )}
              {testing && levelBar}
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
              {levelBar}
              <div style={{ fontSize:10, color:"#64748b", margin:"8px 0 2px" }}>
                10분마다 서버에 자동 저장 · 저장됨 {segmentInfo.uploaded}개
                {segmentInfo.failed > 0 && <span style={{ color:"#f87171" }}> · 실패 {segmentInfo.failed}개(종료 시 PC에 저장)</span>}
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

        {lastSession && !recording && (
          <button onClick={() => downloadBlobs(lastSession.blobs, `${lastSession.name}-수업녹음`)}
            style={{ width:"100%", marginBottom:14, padding:"10px", borderRadius:10,
              border:"1px solid #334155", background:"#1e293b", color:"#cbd5e1",
              fontSize:12, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
            <Upload size={13} style={{ transform:"rotate(180deg)" }}/>
            방금 녹음 원본을 PC에 저장 ({lastSession.blobs.length}개 파일)
          </button>
        )}

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
                     : rec.status==="recording" ? "녹음중/미처리"
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
                      {rec.transcript && <>
                        <button onClick={() => downloadTranscript(rec, "txt")}
                          style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:8, border:"1px solid #334155", background:"#172033", color:"#cbd5e1", fontSize:10, fontWeight:700, cursor:"pointer" }}>
                          <FileText size={11}/> TXT 출력
                        </button>
                        <button onClick={() => downloadTranscript(rec, "doc")}
                          style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 10px", borderRadius:8, border:"1px solid #334155", background:"#172033", color:"#cbd5e1", fontSize:10, fontWeight:700, cursor:"pointer" }}>
                          <FileText size={11}/> DOC 출력
                        </button>
                      </>}
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
                      <button onClick={() => reAnalyze(rec, true)}
                        disabled={processing===rec.id}
                        style={{ display:"flex", alignItems:"center", gap:6,
                          padding:"6px 14px", borderRadius:8, border:"1px solid rgba(245,158,11,0.35)",
                          background: processing===rec.id ? "#1e293b" : "rgba(245,158,11,0.12)",
                          color: processing===rec.id ? "#475569" : "#fbbf24",
                          fontSize:11, fontWeight:700, cursor:"pointer" }}>
                        <RefreshCw size={11}/>
                        원본 재전사 후 분석
                      </button>
                      {(processing===rec.id || processResult[rec.id]) && (
                        <span style={{ fontSize:10, color:"#f59e0b", alignSelf:"center" }}>
                          {processing===rec.id ? notice : processResult[rec.id]}
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

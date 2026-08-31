import { useEffect, useRef, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
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

export default function LessonRecorder({
  studentCode,
  studentName,
}: {
  studentCode: string;
  studentName: string;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [expandId, setExpandId] = useState<string | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    loadRecordings();
  }, []);

  async function loadRecordings() {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/lesson_recordings?student_code=eq.${studentCode}&order=recorded_at.desc`,
        { headers: SB_H }
      );
      const data = await res.json();
      setRecordings(Array.isArray(data) ? data : []);
    } catch { setError("기록 로딩 실패"); }
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm" : "audio/ogg;codecs=opus";
      const mr = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(1000);
      mediaRef.current = mr;
      startTimeRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch(e) {
      const msg = (e as Error).message;
      if (msg.includes("denied") || msg.includes("Permission")) {
        setPermissionDenied(true);
        setError("마이크 접근이 거부됐습니다. 브라우저 설정에서 마이크를 허용해주세요.");
      } else {
        setError("녹음 시작 실패: " + msg);
      }
    }
  }

  async function stopRecording() {
    if (!mediaRef.current) return;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);

    mediaRef.current.stop();
    mediaRef.current.stream.getTracks().forEach(t => t.stop());

    await new Promise<void>(resolve => {
      mediaRef.current!.onstop = () => resolve();
    });

    const blob = new Blob(chunksRef.current, { type: mediaRef.current.mimeType });
    await uploadRecording(blob, duration);
  }

  async function uploadRecording(blob: Blob, duration: number) {
    setUploading(true);
    try {
      const ext = blob.type.includes("webm") ? "webm" : "ogg";
      const filename = `${studentCode}/${Date.now()}.${ext}`;

      // 1. Storage 업로드
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/lesson-recordings/${filename}`,
        { method: "POST", headers: { ...SB_H }, body: blob }
      );
      if (!upRes.ok) throw new Error("업로드 실패: " + await upRes.text());

      // 2. DB 기록 저장 (비공개 버킷 → signed URL 경로 저장)
      const audioPath = filename;
      const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings`, {
        method: "POST",
        headers: { ...SB_H, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify({
          student_code: studentCode,
          student_name: studentName,
          audio_url: audioPath,
          duration_sec: duration,
          status: "uploaded",
        }),
      });
      if (!dbRes.ok) throw new Error("DB 저장 실패");
      const [rec] = await dbRes.json();

      setNotice("녹음이 저장됐습니다. 선생님이 분석 후 결과를 알려드립니다.");
      setTimeout(() => setNotice(""), 4000);
      await loadRecordings();

      // 3. Whisper 변환 요청 (백그라운드)
      requestTranscription(rec.id, audioPath).catch(console.error);
    } catch(e) {
      setError("저장 실패: " + (e as Error).message);
    }
    setUploading(false);
  }

  async function requestTranscription(recordingId: string, audioPath: string) {
    // status를 transcribing으로 업데이트
    await fetch(`${SUPABASE_URL}/rest/v1/lesson_recordings?id=eq.${recordingId}`, {
      method: "PATCH",
      headers: { ...SB_H, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "transcribing" }),
    });
    await loadRecordings();
    // 실제 Whisper 변환은 관리자 앱에서 처리
  }

  function formatTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  return (
    <div style={{ padding:"0 0 24px" }}>
      <h2 style={{ fontSize:18, fontWeight:700, color:"#0891b2", marginBottom:6 }}>
        🎙 수업 녹음
      </h2>
      <p style={{ fontSize:13, color:"#64748b", marginBottom:16 }}>
        수업 중 궁금한 내용이나 선생님 설명을 녹음해두면 분석해드립니다.
      </p>

      {notice && <p style={{ color:"#059669", fontWeight:600, marginBottom:10 }}>{notice}</p>}
      {error && <p style={{ color:"#ef4444", fontSize:13, marginBottom:10,
        background:"#fef2f2", padding:"8px 12px", borderRadius:8 }}>{error}</p>}

      {/* 녹음 버튼 */}
      <div style={{ textAlign:"center", padding:"24px 0", marginBottom:20 }}>
        {!recording ? (
          <button onClick={startRecording} disabled={uploading || permissionDenied}
            style={{ width:100, height:100, borderRadius:"50%", border:"none",
              background: uploading ? "#e2e8f0" : "#0891b2",
              color:"#fff", fontSize:36, cursor: uploading ? "not-allowed" : "pointer",
              boxShadow:"0 4px 20px rgba(8,145,178,0.4)",
              transition:"transform 0.1s",
            }}>
            🎙
          </button>
        ) : (
          <button onClick={stopRecording}
            style={{ width:100, height:100, borderRadius:"50%", border:"none",
              background:"#ef4444", color:"#fff", fontSize:36, cursor:"pointer",
              boxShadow:"0 4px 20px rgba(239,68,68,0.4)",
              animation:"pulse 1s infinite",
            }}>
            ⏹
          </button>
        )}
        <div style={{ marginTop:14 }}>
          {recording ? (
            <div>
              <div style={{ fontSize:28, fontWeight:700, color:"#ef4444", fontVariantNumeric:"tabular-nums" }}>
                {formatTime(elapsed)}
              </div>
              <p style={{ fontSize:13, color:"#ef4444", fontWeight:600, marginTop:4 }}>
                ● 녹음 중… 중지하려면 버튼을 누르세요
              </p>
            </div>
          ) : uploading ? (
            <p style={{ fontSize:13, color:"#0891b2", fontWeight:600 }}>업로드 중…</p>
          ) : (
            <p style={{ fontSize:13, color:"#94a3b8" }}>버튼을 눌러 녹음을 시작하세요</p>
          )}
        </div>
      </div>

      {/* 녹음 이력 */}
      {recordings.length > 0 && (
        <div>
          <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", marginBottom:10 }}>
            📋 내 녹음 이력
          </h3>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {recordings.map(rec => (
              <div key={rec.id} style={{ border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
                <div style={{ padding:"10px 14px", background:"#f8fafc",
                  display:"flex", justifyContent:"space-between", alignItems:"center",
                  cursor:"pointer" }} onClick={() => setExpandId(expandId===rec.id ? null : rec.id)}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:18 }}>🎙</span>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>
                        {new Date(rec.recorded_at).toLocaleDateString("ko-KR")} {new Date(rec.recorded_at).toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit"})}
                      </div>
                      <div style={{ fontSize:11, color:"#94a3b8" }}>
                        {formatTime(rec.duration_sec)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:11, padding:"2px 8px", borderRadius:8, fontWeight:600,
                      background: rec.status==="done" ? "#d1fae5" : rec.status==="transcribing" ? "#fef3c7" : "#f1f5f9",
                      color: rec.status==="done" ? "#059669" : rec.status==="transcribing" ? "#d97706" : "#64748b" }}>
                      {rec.status==="done" ? "✅ 분석완료" : rec.status==="transcribing" ? "⏳ 분석중" : "📤 업로드됨"}
                    </span>
                    <span style={{ color:"#94a3b8" }}>{expandId===rec.id ? "▲" : "▼"}</span>
                  </div>
                </div>
                {expandId === rec.id && (
                  <div style={{ padding:"12px 14px" }}>
                    {rec.status === "done" ? (
                      <div>
                        {rec.transcript && (
                          <div style={{ marginBottom:12 }}>
                            <p style={{ fontSize:11, fontWeight:600, color:"#94a3b8", marginBottom:6 }}>📝 변환 텍스트</p>
                            <p style={{ fontSize:12, color:"#374151", lineHeight:1.7,
                              background:"#f8fafc", padding:"10px", borderRadius:8 }}>
                              {rec.transcript}
                            </p>
                          </div>
                        )}
                        {rec.analysis && (
                          <div style={{ marginBottom:12 }}>
                            <p style={{ fontSize:11, fontWeight:600, color:"#94a3b8", marginBottom:6 }}>🔍 선생님 분석</p>
                            <pre style={{ fontSize:12, color:"#166534", lineHeight:1.7,
                              background:"#f0fdf4", padding:"10px", borderRadius:8,
                              whiteSpace:"pre-wrap", fontFamily:"inherit", margin:0 }}>
                              {rec.analysis}
                            </pre>
                          </div>
                        )}
                        {rec.keywords?.length > 0 && (
                          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                            {rec.keywords.map(k => (
                              <span key={k} style={{ fontSize:11, padding:"2px 8px", borderRadius:10,
                                background:"#dbeafe", color:"#1e40af", fontWeight:600 }}>{k}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : rec.status === "transcribing" ? (
                      <p style={{ fontSize:13, color:"#d97706", textAlign:"center", padding:"10px 0" }}>
                        ⏳ 선생님이 분석 중입니다. 잠시 후 확인해주세요.
                      </p>
                    ) : (
                      <p style={{ fontSize:13, color:"#94a3b8", textAlign:"center", padding:"10px 0" }}>
                        선생님이 곧 확인하실 예정입니다.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 4px 20px rgba(239,68,68,0.4); }
          50% { transform: scale(1.05); box-shadow: 0 4px 30px rgba(239,68,68,0.6); }
        }
      `}</style>
    </div>
  );
}

import { useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export default function ExamPaperUpload() {
  const [studentCode, setStudentCode] = useState("");
  const [studentName, setStudentName] = useState("");
  const [examId, setExamId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit() {
    if (!file || !studentCode || !studentName || !examId) {
      setError("모든 항목을 입력해주세요."); return;
    }
    setUploading(true); setError("");
    try {
      // 1. Storage 업로드
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${examId}/${studentCode}_${Date.now()}.${ext}`;
      const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/exam-papers/${path}`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        body: file,
      });
      if (!upRes.ok) throw new Error("이미지 업로드 실패");
      const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/exam-papers/${path}`;

      // 2. DB 기록
      await fetch(`${SUPABASE_URL}/rest/v1/exam_papers`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ exam_id: examId, student_code: studentCode, student_name: studentName, image_url: imageUrl }),
      });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (done) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center",
      background:"#f8fafc", padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:32, textAlign:"center", maxWidth:360, width:"100%",
        boxShadow:"0 4px 20px rgba(0,0,0,0.08)" }}>
        <p style={{ fontSize:48, marginBottom:12 }}>✅</p>
        <h2 style={{ color:"#166534", marginBottom:8 }}>제출 완료</h2>
        <p style={{ color:"#64748b", fontSize:14 }}>시험지가 성공적으로 제출됐습니다.<br/>선생님께서 확인하실 예정입니다.</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", padding:20 }}>
      <div style={{ maxWidth:480, margin:"0 auto" }}>
        <h1 style={{ fontSize:20, fontWeight:700, color:"#7c3aed", marginBottom:4 }}>📄 시험지 제출</h1>
        <p style={{ fontSize:13, color:"#64748b", marginBottom:20 }}>시험지를 촬영한 사진을 업로드해주세요.</p>

        {error && <p style={{ color:"#ef4444", fontSize:13, marginBottom:12, background:"#fef2f2",
          padding:"8px 12px", borderRadius:8 }}>{error}</p>}

        <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
          <label style={{ fontSize:13, fontWeight:600, display:"block", marginBottom:4 }}>이름</label>
          <input value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="홍길동"
            style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #e2e8f0",
              fontSize:14, marginBottom:12, boxSizing:"border-box" as const }} />

          <label style={{ fontSize:13, fontWeight:600, display:"block", marginBottom:4 }}>학생 코드 (SMS로 받은 코드)</label>
          <input value={studentCode} onChange={e => setStudentCode(e.target.value)} placeholder="예) ABC12345"
            style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #e2e8f0",
              fontSize:14, marginBottom:12, boxSizing:"border-box" as const }} />

          <label style={{ fontSize:13, fontWeight:600, display:"block", marginBottom:4 }}>시험 코드 (SMS로 받은 코드)</label>
          <input value={examId} onChange={e => setExamId(e.target.value)} placeholder="예) ex2026mid"
            style={{ width:"100%", padding:"10px 12px", borderRadius:8, border:"1px solid #e2e8f0",
              fontSize:14, marginBottom:16, boxSizing:"border-box" as const }} />

          <label style={{ fontSize:13, fontWeight:600, display:"block", marginBottom:8 }}>시험지 사진</label>
          <label style={{ display:"block", border:"2px dashed #7c3aed", borderRadius:10, padding:"20px",
            textAlign:"center", cursor:"pointer", background:"#faf5ff", marginBottom:12 }}>
            <input type="file" accept="image/*" capture="environment" onChange={handleFile}
              style={{ display:"none" }} />
            {preview ? (
              <img src={preview} alt="미리보기" style={{ maxWidth:"100%", borderRadius:8 }} />
            ) : (
              <div>
                <p style={{ fontSize:32, marginBottom:4 }}>📷</p>
                <p style={{ fontSize:13, color:"#7c3aed", fontWeight:600 }}>사진 촬영 또는 파일 선택</p>
                <p style={{ fontSize:11, color:"#94a3b8" }}>시험지 전체가 잘 보이도록 촬영해주세요</p>
              </div>
            )}
          </label>

          <button onClick={submit} disabled={uploading || !file}
            style={{ width:"100%", padding:14, borderRadius:10, border:"none",
              background: uploading || !file ? "#e2e8f0" : "#7c3aed",
              color: uploading || !file ? "#94a3b8" : "#fff",
              fontWeight:700, fontSize:15, cursor: uploading || !file ? "not-allowed" : "pointer" }}>
            {uploading ? "제출 중…" : "시험지 제출"}
          </button>
        </div>
      </div>
    </div>
  );
}

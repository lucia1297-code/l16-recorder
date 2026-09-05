import { ClipboardList, LayoutList, FileInput, MessageSquare, Clock, CheckCircle, Pencil, Send } from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SOLAPI_API_KEY = import.meta.env.VITE_SOLAPI_API_KEY as string;
const SOLAPI_API_SECRET = import.meta.env.VITE_SOLAPI_API_SECRET as string;
const SOLAPI_SENDER = import.meta.env.VITE_SOLAPI_SENDER as string;
const SB_H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };


// ═══════════════════════════════════════════════════════
// 시험 준비 패널
// ═══════════════════════════════════════════════════════

interface ExamSchedule {
  id: string;
  studentCode: string;
  semester: "1" | "2";               // 1학기 / 2학기
  examType: "midterm" | "final";     // 중간 / 기말
  subject: string;                   // 과목명
  examStart: string;                 // 시험 시작일
  examEnd: string;                   // 시험 종료일
  englishExamDate: string;           // 영어 시험일
  examRange: string;                 // 시험 범위
  reportDeadline: string;            // 직보일 (성적 보고 기한)
  nextLessonDate: string;            // 시험 후 다음 수업 예정일
  score: number | null;              // 시험 결과 점수
  examPaperReceived: boolean;        // 시험지 수령 여부
  completed: boolean;                // 시험 완료 여부
  memo: string;
}

function examId() {
  return Math.random().toString(36).slice(2, 10);
}

const EMPTY_EXAM: Omit<ExamSchedule, "id" | "studentCode"> = {
  semester: "1",
  examType: "midterm",
  subject: "영어",
  examStart: "",
  examEnd: "",
  englishExamDate: "",
  examRange: "",
  reportDeadline: "",
  nextLessonDate: "",
  score: null,
  examPaperReceived: false,
  completed: false,
  memo: "",
};

// ── Supabase 시험지 업로드 헬퍼 ─────────────────────

async function uploadExamPaper(file: File, examId: string, studentCode: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const path = `${examId}/${studentCode}_${Date.now()}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/exam-papers/${path}`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    body: file,
  });
  if (!res.ok) throw new Error("업로드 실패: " + await res.text());
  return `${SUPABASE_URL}/storage/v1/object/public/exam-papers/${path}`;
}

async function saveExamPaperRecord(examId: string, studentCode: string, studentName: string, imageUrl: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/exam_papers`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ exam_id: examId, student_code: studentCode, student_name: studentName, image_url: imageUrl }),
  });
}

async function fetchExamPapers(examId: string): Promise<{id:string;student_code:string;student_name:string;image_url:string;submitted_at:string}[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/exam_papers?exam_id=eq.${examId}&order=submitted_at.desc`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
  });
  return res.ok ? res.json() : [];
}

// ── SMS 시험지 제출 요청 발송 ─────────────────────────
async function sendExamPaperRequestSMS(phone: string, studentName: string, subject: string): Promise<void> {
  const { SolapiSmsProvider } = await import("../../lib/sms.solapi");
  const sms = new SolapiSmsProvider(
    import.meta.env.VITE_SOLAPI_API_KEY,
    import.meta.env.VITE_SOLAPI_API_SECRET,
    import.meta.env.VITE_SOLAPI_SENDER,
  );
  await sms.send(phone, `[L16] ${studentName} 학생, ${subject} 시험지 촬영 후 앱에서 제출해주세요. https://l16-academy.surge.sh`);
}


export default function ExamPrepPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamSchedule | null>(null);
  const [form, setForm] = useState<Omit<ExamSchedule, "id" | "studentCode">>(EMPTY_EXAM);
  const [viewFilter, setViewFilter] = useState<"all" | "upcoming" | "completed">("upcoming");
  const [viewMode, setViewMode] = useState<"admin" | "student" | "consult">("admin");
  const [studentExams, setStudentExams] = useState<any[]>([]);
  const [consultMsgs, setConsultMsgs] = useState<any[]>([]);
  const [replyId, setReplyId] = useState<string|null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [notice, setNotice] = useState("");
  const [paperModal, setPaperModal] = useState<ExamSchedule | null>(null);
  const [papers, setPapers] = useState<{id:string;student_code:string;student_name:string;image_url:string;submitted_at:string}[]>([]);
  const [papersLoading, setPapersLoading] = useState(false);
  const [smsSending, setSmsSending] = useState<string | null>(null);

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    // Supabase 우선 로드 (localStorage는 오프라인 폴백)
    loadExamsFromSupabase().then(sbExams => {
      if (sbExams.length > 0) {
        setExams(sbExams);
        // Supabase 데이터로 localStorage도 갱신
        localStorage.setItem("l16.examSchedules", JSON.stringify(
          sbExams.map(ex => ({
            id: ex.id, studentCode: ex.studentCode, semester: ex.semester,
            examType: ex.examType, subject: ex.subject,
            examStart: ex.examStart, examEnd: ex.examEnd,
            englishExamDate: ex.englishExamDate, examRange: ex.examRange,
            reportDeadline: ex.reportDeadline, nextLessonDate: ex.nextLessonDate,
            score: ex.score, examPaperReceived: ex.examPaperReceived,
            completed: ex.completed, memo: ex.memo,
          }))
        ));
      } else {
        // Supabase 없으면 localStorage 폴백
        const saved = localStorage.getItem("l16.examSchedules");
        if (saved) {
          const parsed = JSON.parse(saved);
          setExams(parsed);
          // localStorage 데이터를 Supabase에 백업
          syncExamsToSupabase(parsed).catch(() => {});
        }
      }
    });
    // 학생이 직접 등록한 시험 + 상담 메시지 로딩
    fetch(`${SUPABASE_URL}/rest/v1/student_exams?order=submitted_at.desc`, { headers: SB_H })
      .then(r => r.json()).then(d => setStudentExams(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${SUPABASE_URL}/rest/v1/consultation_messages?order=created_at.desc`, { headers: SB_H })
      .then(r => r.json()).then(d => setConsultMsgs(Array.isArray(d) ? d : [])).catch(() => {});
  }, [rosterStore]);

  function saveExams(newExams: ExamSchedule[]) {
    setExams(newExams);
    // 1. localStorage 백업 (오프라인 대응)
    localStorage.setItem("l16.examSchedules", JSON.stringify(newExams));
    // 2. Supabase 영구 저장 (비동기 - 실패해도 UI는 정상)
    syncExamsToSupabase(newExams).catch(e =>
      console.warn("[ExamSync] Supabase 동기화 실패:", e)
    );
  }

  async function syncExamsToSupabase(exams: ExamSchedule[]) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    for (const ex of exams) {
      await fetch(`${SUPABASE_URL}/rest/v1/admin_exam_schedules`, {
        method: "POST",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates",  // upsert
        },
        body: JSON.stringify({
          id: ex.id,
          student_code: ex.studentCode,
          semester: ex.semester,
          exam_type: ex.examType,
          subject: ex.subject,
          exam_start: ex.examStart,
          exam_end: ex.examEnd,
          english_exam_date: ex.englishExamDate,
          exam_range: ex.examRange,
          report_deadline: ex.reportDeadline,
          next_lesson_date: ex.nextLessonDate,
          score: ex.score,
          exam_paper_received: ex.examPaperReceived,
          completed: ex.completed,
          memo: ex.memo,
          updated_at: new Date().toISOString(),
        }),
      });
    }
  }

  async function loadExamsFromSupabase(): Promise<ExamSchedule[]> {
    if (!SUPABASE_URL || !SUPABASE_KEY) return [];
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_exam_schedules?order=created_at.asc`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
      );
      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((r: any): ExamSchedule => ({
        id: r.id,
        studentCode: r.student_code,
        semester: r.semester,
        examType: r.exam_type,
        subject: r.subject ?? "영어",
        examStart: r.exam_start ?? "",
        examEnd: r.exam_end ?? "",
        englishExamDate: r.english_exam_date ?? "",
        examRange: r.exam_range ?? "",
        reportDeadline: r.report_deadline ?? "",
        nextLessonDate: r.next_lesson_date ?? "",
        score: r.score ?? null,
        examPaperReceived: r.exam_paper_received ?? false,
        completed: r.completed ?? false,
        memo: r.memo ?? "",
      }));
    } catch(e) {
      console.warn("[ExamSync] Supabase 로드 실패:", e);
      return [];
    }
  }

  async function deleteExamFromSupabase(id: string) {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    await fetch(
      `${SUPABASE_URL}/rest/v1/admin_exam_schedules?id=eq.${id}`,
      { method: "DELETE",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    ).catch(e => console.warn("[ExamSync] 삭제 실패:", e));
  }

  async function sendReply(msgId: string) {
    if (!replyText.trim()) return;
    setReplying(true);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/consultation_messages?id=eq.${msgId}`, {
        method: "PATCH",
        headers: { ...SB_H, "Content-Type": "application/json" },
        body: JSON.stringify({ admin_reply: replyText, replied_at: new Date().toISOString(), is_read: true }),
      });
      setConsultMsgs(prev => prev.map(m => m.id === msgId
        ? { ...m, admin_reply: replyText, replied_at: new Date().toISOString() } : m));
      setReplyId(null); setReplyText("");
      setNotice("답변을 전송했습니다."); setTimeout(() => setNotice(""), 3000);
    } catch { setNotice("답변 전송 실패"); }
    setReplying(false);
  }

  async function confirmStudentExam(id: string) {
    await fetch(`${SUPABASE_URL}/rest/v1/student_exams?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...SB_H, "Content-Type": "application/json" },
      body: JSON.stringify({ admin_confirmed: true }),
    });
    setStudentExams(prev => prev.map(e => e.id === id ? { ...e, admin_confirmed: true } : e));
    setNotice("확인 처리됐습니다."); setTimeout(() => setNotice(""), 3000);
  }

  function daysUntil(dateStr: string): number {
    if (!dateStr) return 999;
    return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  }

  function addOrUpdateExam() {
    if (!selectedStudent) return;
    if (editingExam) {
      saveExams(exams.map(e => e.id === editingExam.id ? { ...editingExam, ...form } : e));
    } else {
      saveExams([...exams, { id: examId(), studentCode: selectedStudent, ...form }]);
    }
    setShowForm(false); setEditingExam(null); setForm(EMPTY_EXAM);
    setNotice("저장됐습니다."); setTimeout(() => setNotice(""), 2000);
  }

  function deleteExam(id: string) {
    if (!confirm("삭제하시겠습니까?")) return;
    saveExams(exams.filter(e => e.id !== id));
    deleteExamFromSupabase(id);  // Supabase에서도 삭제
  }

  function updateResult(id: string, field: "score" | "examPaperReceived" | "completed", value: any) {
    saveExams(exams.map(e => e.id === id ? { ...e, [field]: value } : e));
  }

  // 시험지 모달 열기
  async function openPaperModal(ex: ExamSchedule) {
    setPaperModal(ex);
    setPapersLoading(true);
    const result = await fetchExamPapers(ex.id);
    setPapers(result);
    setPapersLoading(false);
  }

  // SMS 발송
  async function sendSmsRequest(ex: ExamSchedule) {
    const student = roster.find(r => r.studentCode === ex.studentCode);
    if (!student?.phone) return alert("학생 전화번호가 없습니다.");
    setSmsSending(ex.id);
    try {
      await sendExamPaperRequestSMS(student.phone, student.name, ex.subject);
      setNotice(`${student.name} 학생에게 시험지 제출 요청 SMS 발송 완료`);
      setTimeout(() => setNotice(""), 3000);
    } catch (e) {
      alert("SMS 발송 실패: " + (e as Error).message);
    } finally {
      setSmsSending(null);
    }
  }

  const activeRoster = roster.filter(r => (r.studentStatus ?? "active") !== "withdrawn");
  const filteredExams = exams.filter(ex => {
    if (selectedStudent && ex.studentCode !== selectedStudent) return false;
    if (viewFilter === "upcoming") return !ex.completed;
    if (viewFilter === "completed") return ex.completed;
    return true;
  }).sort((a, b) => (a.englishExamDate || "z").localeCompare(b.englishExamDate || "z"));

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <h2 style={{ margin:0, color:"#7c3aed" }}>📝 시험 준비 현황판</h2>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2 }}>
            {([
              {key:"admin", label:"📋 내 관리"},
              {key:"student", label:`📩 학생등록 ${studentExams.length > 0 ? `(${studentExams.length})` : ""}`},
              {key:"consult", label:`💬 상담 ${consultMsgs.filter(m=>!m.admin_reply).length > 0 ? `(${consultMsgs.filter(m=>!m.admin_reply).length})` : ""}`},
            ] as const).map(t => (
              <button key={t.key} onClick={() => setViewMode(t.key)}
                style={{ padding:"5px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, cursor:"pointer",
                  background: viewMode===t.key ? "#7c3aed" : "transparent",
                  color: viewMode===t.key ? "#fff" : "#64748b" }}>
                {t.label}
              </button>
            ))}
          </div>
          {viewMode === "admin" && (
            <button onClick={() => { setShowForm(true); setEditingExam(null); setForm(EMPTY_EXAM); }}
              style={{ padding:"7px 16px", background:"#7c3aed", color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:13, cursor:"pointer" }}>
              + 시험 일정 추가
            </button>
          )}
        </div>
      </div>

      {notice && <p style={{ color:"#7c3aed", fontWeight:600, marginBottom:10 }}>{notice}</p>}

      {/* ── 학생 직접 등록 시험 ── */}
      {viewMode === "student" && (
        <div>
          <p style={{ fontSize:13, color:"#64748b", marginBottom:12 }}>학생이 직접 등록한 시험 일정입니다. 확인 후 처리해주세요.</p>
          {studentExams.length === 0 ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>학생이 등록한 시험이 없습니다.</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {studentExams
                .filter(e => !selectedStudent || e.student_code === selectedStudent)
                .map((ex, i) => {
                  const dl = ex.english_exam_date
                    ? Math.ceil((new Date(ex.english_exam_date).getTime() - Date.now()) / 86400000) : null;
                  return (
                    <div key={i} style={{ border:`1.5px solid ${ex.admin_confirmed?"#86efac":"#fbbf24"}`,
                      borderRadius:12, overflow:"hidden", background: ex.admin_confirmed?"#f0fdf4":"#fffbeb" }}>
                      <div style={{ padding:"10px 14px", background: ex.admin_confirmed?"#d1fae5":"#fef3c7",
                        borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between",
                        alignItems:"center", flexWrap:"wrap", gap:8 }}>
                        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                          <span style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>{ex.student_name}</span>
                          <span style={{ fontSize:11, background:"#ede9fe", color:"#7c3aed", padding:"1px 7px", borderRadius:8, fontWeight:600 }}>
                            {ex.semester}학기 {ex.exam_type==="midterm"?"중간":"기말"}
                          </span>
                          <span style={{ fontSize:11, background:"#f1f5f9", color:"#475569", padding:"1px 7px", borderRadius:8 }}>{ex.subject}</span>
                          {dl !== null && dl >= 0 && <span style={{ fontSize:12, fontWeight:700, color: dl<=7?"#dc2626":"#f97316" }}>D-{dl}</span>}
                          {ex.admin_confirmed
                            ? <span style={{ fontSize:11, color:"#059669", fontWeight:600 }}>확인완료</span>
                            : <span style={{ fontSize:11, color:"#d97706", fontWeight:600 }}>미확인</span>}
                        </div>
                        {!ex.admin_confirmed && (
                          <button onClick={() => confirmStudentExam(ex.id)}
                            style={{ padding:"4px 12px", borderRadius:7, border:"none", background:"#7c3aed",
                              color:"#fff", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                            확인 처리
                          </button>
                        )}
                      </div>
                      <div style={{ padding:"10px 14px", display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))", gap:"6px 12px", fontSize:12 }}>
                        {[
                          { label:"시험 기간", value: ex.exam_start && ex.exam_end ? `${ex.exam_start.slice(5)} ~ ${ex.exam_end.slice(5)}` : "-" },
                          { label:"영어 시험일", value: ex.english_exam_date?.slice(5) ?? "-" },
                          { label:"직보일", value: ex.report_deadline?.slice(5) ?? "-" },
                          { label:"다음 수업", value: ex.next_lesson_date?.slice(5) ?? "-" },
                          { label:"시험 범위", value: ex.exam_range || "-" },
                          { label:"시험지 제출", value: ex.exam_paper_submitted ? "✅ 완료" : "❌ 미제출" },
                        ].map(it => (
                          <div key={it.label}>
                            <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600 }}>{it.label}</div>
                            <div style={{ color:"#374151" }}>{it.value}</div>
                          </div>
                        ))}
                      </div>
                      {ex.memo && <div style={{ padding:"6px 14px 10px", fontSize:12, color:"#64748b" }}>메모: {ex.memo}</div>}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ── 상담 메시지 ── */}
      {viewMode === "consult" && (
        <div>
          <p style={{ fontSize:13, color:"#64748b", marginBottom:12 }}>학생들이 보낸 상담 메시지입니다. 답변 후 학생 앱에 표시됩니다.</p>
          {consultMsgs.length === 0 ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>상담 메시지가 없습니다.</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {consultMsgs
                .filter(m => !selectedStudent || m.student_code === selectedStudent)
                .map((m, i) => (
                  <div key={i} style={{ border:`1.5px solid ${m.admin_reply?"#d1fae5":"#fbbf24"}`,
                    borderRadius:12, overflow:"hidden", background: m.admin_reply?"#f0fdf4":"#fff" }}>
                    <div style={{ padding:"10px 14px", background: m.admin_reply?"#d1fae5":"#fef3c7",
                      borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between",
                      alignItems:"center" }}>
                      <div>
                        <span style={{ fontWeight:700, fontSize:13 }}>{m.student_name}</span>
                        <span style={{ fontSize:11, color:"#94a3b8", marginLeft:8 }}>{m.created_at?.slice(0,10)}</span>
                        {m.admin_reply
                          ? <span style={{ fontSize:11, color:"#059669", marginLeft:8, fontWeight:600 }}>답변완료</span>
                          : <span style={{ fontSize:11, color:"#d97706", marginLeft:8, fontWeight:600 }}>답변 필요</span>}
                      </div>
                    </div>
                    <div style={{ padding:"12px 14px" }}>
                      <p style={{ fontSize:13, color:"#374151", margin:"0 0 10px", whiteSpace:"pre-wrap" }}>{m.message}</p>
                      {m.admin_reply ? (
                        <div style={{ background:"#f0fdf4", borderRadius:8, padding:"10px 12px", border:"1px solid #86efac" }}>
                          <p style={{ fontSize:11, color:"#059669", fontWeight:600, marginBottom:4 }}>내 답변</p>
                          <p style={{ fontSize:13, color:"#166534", margin:0, whiteSpace:"pre-wrap" }}>{m.admin_reply}</p>
                        </div>
                      ) : replyId === m.id ? (
                        <div>
                          <textarea value={replyText} onChange={e => setReplyText(e.target.value)}
                            placeholder="답변을 입력하세요" rows={3}
                            style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #7c3aed",
                              fontSize:13, resize:"none" as const, boxSizing:"border-box" as const, marginBottom:8 }} />
                          <div style={{ display:"flex", gap:6 }}>
                            <button onClick={() => sendReply(m.id)} disabled={replying}
                              style={{ flex:1, padding:"8px", borderRadius:7, border:"none",
                                background:"#7c3aed", color:"#fff", fontWeight:600, fontSize:13, cursor:"pointer" }}>
                              {replying ? "전송 중…" : "답변 전송"}
                            </button>
                            <button onClick={() => { setReplyId(null); setReplyText(""); }}
                              style={{ padding:"8px 14px", borderRadius:7, border:"1px solid #e2e8f0",
                                background:"#fff", fontSize:13, cursor:"pointer" }}>취소</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setReplyId(m.id); setReplyText(""); }}
                          style={{ padding:"7px 16px", borderRadius:8, border:"1.5px solid #7c3aed",
                            background:"#fff", color:"#7c3aed", fontWeight:600, fontSize:12, cursor:"pointer" }}>
                          답변하기
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ── 기존 관리자 등록 탭 ── */}
      {viewMode === "admin" && (
        <div>
        {/* 필터 */}
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
          <option value="">전체 학생</option>
          {activeRoster.map(r => (
            <option key={r.studentCode} value={r.studentCode}>{r.name} ({r.school})</option>
          ))}
        </select>
        <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2 }}>
          {(["upcoming","all","completed"] as const).map(f => (
            <button key={f} onClick={() => setViewFilter(f)}
              style={{ padding:"5px 12px", borderRadius:6, border:"none", fontSize:12, fontWeight:600, cursor:"pointer",
                background: viewFilter === f ? "#7c3aed" : "transparent",
                color: viewFilter === f ? "#fff" : "#64748b" }}>
              {f === "upcoming" ? "진행중" : f === "completed" ? "완료" : "전체"}
            </button>
          ))}
        </div>
      </div>

      {/* 시험 카드 목록 */}
      {filteredExams.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
          <p style={{ fontSize:32, marginBottom:8 }}></p>
          <p>등록된 시험 일정이 없습니다.</p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {filteredExams.map(ex => {
            const student = roster.find(r => r.studentCode === ex.studentCode);
            const daysLeft = daysUntil(ex.englishExamDate);
            const isUrgent = daysLeft >= 0 && daysLeft <= 7;
            return (
              <div key={ex.id} style={{
                border: `1.5px solid ${ex.completed ? "#d1fae5" : isUrgent ? "#fca5a5" : "#e2e8f0"}`,
                borderRadius:12, overflow:"hidden",
                background: ex.completed ? "#f0fdf4" : isUrgent ? "#fff5f5" : "#fff",
              }}>
                {/* 카드 헤더 */}
                <div style={{ padding:"10px 14px", background: ex.completed ? "#d1fae5" : isUrgent ? "#fee2e2" : "#f8fafc",
                  borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>{student?.name ?? "?"}</span>
                    <span style={{ fontSize:11, color:"#64748b" }}>{student?.school}</span>
                    <span style={{ fontSize:11, background:"#ede9fe", color:"#7c3aed", padding:"1px 7px", borderRadius:10, fontWeight:600 }}>
                      {ex.semester}학기 {ex.examType === "midterm" ? "중간" : "기말"}
                    </span>
                    <span style={{ fontSize:11, background:"#f1f5f9", color:"#475569", padding:"1px 7px", borderRadius:10 }}>{ex.subject}</span>
                    {ex.completed
                      ? <span style={{ fontSize:11, background:"#d1fae5", color:"#166534", padding:"1px 7px", borderRadius:10, fontWeight:700 }}>✅ 완료</span>
                      : isUrgent
                        ? <span style={{ fontSize:12, background:"#ef4444", color:"#fff", padding:"2px 8px", borderRadius:10, fontWeight:700 }}>D-{daysLeft}</span>
                        : daysLeft < 30 && daysLeft >= 0
                          ? <span style={{ fontSize:11, color:"#f97316", fontWeight:700 }}>D-{daysLeft}</span>
                          : null}
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={() => sendSmsRequest(ex)} disabled={smsSending === ex.id}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #f97316", borderRadius:6, cursor:"pointer", background:"#fff7ed", color:"#c2410c", fontWeight:600 }}>
                      {smsSending === ex.id ? "발송 중…" : "📱 시험지 요청 SMS"}
                    </button>
                    <button onClick={() => openPaperModal(ex)}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #7c3aed", borderRadius:6, cursor:"pointer", background:"#ede9fe", color:"#7c3aed", fontWeight:600 }}>
                      🗂 시험지 보기
                    </button>
                    <button onClick={() => { setEditingExam(ex); setForm({...ex}); setShowForm(true); setSelectedStudent(ex.studentCode); }}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #e2e8f0", borderRadius:6, cursor:"pointer", background:"#fff" }}>수정</button>
                    <button onClick={() => deleteExam(ex.id)}
                      style={{ fontSize:11, padding:"3px 10px", border:"1px solid #fca5a5", borderRadius:6, cursor:"pointer", background:"#fff", color:"#ef4444" }}>삭제</button>
                  </div>
                </div>

                {/* 시험 정보 */}
                <div style={{ padding:"12px 14px", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:"8px 16px" }}>
                  {[
                    { label:"시험기간", value: ex.examStart && ex.examEnd ? `${ex.examStart} ~ ${ex.examEnd}` : "-" },
                    { label:"영어 시험일", value: ex.englishExamDate || "-" },
                    { label:"직보일", value: ex.reportDeadline || "-" },
                    { label:"남은 날짜", value: ex.englishExamDate ? (daysLeft < 0 ? `D+${Math.abs(daysLeft)}` : `D-${daysLeft}`) : "-",
                      color: daysLeft <= 3 ? "#ef4444" : daysLeft <= 7 ? "#f97316" : "#2563eb" },
                    { label:"다음 수업", value: ex.nextLessonDate || "-" },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600, marginBottom:2 }}>{item.label}</div>
                      <div style={{ fontSize:13, fontWeight:500, color: item.color ?? "#1e293b" }}>{item.value}</div>
                    </div>
                  ))}
                </div>

                {/* 시험 범위 — 가로 전체 메모 형식 */}
                {ex.examRange && (
                  <div style={{
                    margin:"8px 0 0",
                    padding:"8px 12px",
                    background:"#f8fafc",
                    borderRadius:8,
                    border:"1px solid #e2e8f0",
                    display:"flex",
                    alignItems:"flex-start",
                    gap:8,
                  }}>
                    <span style={{ fontSize:10, color:"#94a3b8", fontWeight:600,
                      whiteSpace:"nowrap", paddingTop:2 }}>시험 범위</span>
                    <span style={{ fontSize:13, color:"#1e293b", lineHeight:1.6,
                      wordBreak:"break-all", flex:1 }}>
                      {ex.examRange}
                    </span>
                  </div>
                )}

                {/* 결과 섹션 */}
                <div style={{ padding:"10px 14px", borderTop:"1px solid #f1f5f9", background:"#fafafa",
                  display:"flex", alignItems:"center", gap:16, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, fontWeight:600, color:"#475569" }}>시험 결과:</span>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <span style={{ fontSize:12, color:"#64748b" }}>점수</span>
                    <input type="number" placeholder="점수" value={ex.score ?? ""}
                      onChange={e => updateResult(ex.id, "score", e.target.value ? Number(e.target.value) : null)}
                      style={{ width:65, padding:"4px 8px", borderRadius:6, border:"1px solid #e2e8f0", fontSize:13, fontWeight:700, textAlign:"center" }} />
                  </div>
                  <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:12 }}>
                    <input type="checkbox" checked={ex.examPaperReceived}
                      onChange={e => updateResult(ex.id, "examPaperReceived", e.target.checked)}
                      style={{ width:15, height:15 }} />
                    <span style={{ color: ex.examPaperReceived ? "#166534" : "#ef4444", fontWeight:600 }}>
                      {ex.examPaperReceived ? "✅ 시험지 수령" : "❌ 시험지 미수령"}
                    </span>
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:12 }}>
                    <input type="checkbox" checked={ex.completed}
                      onChange={e => updateResult(ex.id, "completed", e.target.checked)}
                      style={{ width:15, height:15 }} />
                    <span style={{ color: ex.completed ? "#166534" : "#64748b", fontWeight:600 }}>시험 완료</span>
                  </label>
                  {ex.completed && !ex.examPaperReceived && (
                    <span style={{ fontSize:11, background:"#fef3c7", color:"#d97706", padding:"2px 8px", borderRadius:8, fontWeight:600, border:"1px solid #fde68a" }}>
                       시험지 등록 요청 필요
                    </span>
                  )}
                </div>
                {ex.memo && (
                  <div style={{ padding:"6px 14px 10px", borderTop:"1px solid #f1f5f9" }}>
                    <span style={{ fontSize:11, color:"#94a3b8" }}>메모: </span>
                    <span style={{ fontSize:12, color:"#475569" }}>{ex.memo}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 시험지 모달 ── */}
      {paperModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:400,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:14, width:"100%", maxWidth:560,
            maxHeight:"90vh", overflowY:"auto", boxShadow:"0 8px 40px rgba(0,0,0,0.25)" }}>
            {/* 모달 헤더 */}
            <div style={{ padding:"16px 20px", borderBottom:"1px solid #e2e8f0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <h3 style={{ margin:0, color:"#7c3aed" }}>🗂 시험지 관리</h3>
                <p style={{ margin:"4px 0 0", fontSize:12, color:"#64748b" }}>
                  {roster.find(r => r.studentCode === paperModal.studentCode)?.name} — {paperModal.subject} {paperModal.examType === "midterm" ? "중간" : "기말"}고사
                </p>
              </div>
              <button onClick={() => setPaperModal(null)}
                style={{ border:"none", background:"none", fontSize:20, cursor:"pointer", color:"#94a3b8" }}>✕</button>
            </div>

            <div style={{ padding:"16px 20px" }}>
              {/* 제출 현황 */}
              <div style={{ marginBottom:16, padding:"10px 14px", borderRadius:10,
                background: papers.length > 0 ? "#f0fdf4" : "#fff5f5",
                border: `1px solid ${papers.length > 0 ? "#86efac" : "#fca5a5"}` }}>
                <p style={{ margin:0, fontWeight:700, color: papers.length > 0 ? "#166534" : "#ef4444" }}>
                  {papers.length > 0 ? `✅ 시험지 ${papers.length}장 제출됨` : "❌ 시험지 미제출"}
                </p>
              </div>

              {/* SMS 발송 버튼 */}
              <button onClick={() => sendSmsRequest(paperModal)} disabled={smsSending === paperModal.id}
                style={{ width:"100%", padding:"10px", marginBottom:16, borderRadius:8, border:"1.5px solid #f97316",
                  background:"#fff7ed", color:"#c2410c", fontWeight:700, fontSize:13, cursor:"pointer" }}>
                📱 시험지 제출 요청 SMS 발송
              </button>

              {/* 제출된 시험지 목록 */}
              {papersLoading ? (
                <p style={{ textAlign:"center", color:"#94a3b8" }}>로딩 중…</p>
              ) : papers.length === 0 ? (
                <p style={{ textAlign:"center", color:"#94a3b8", padding:"20px 0" }}>제출된 시험지가 없습니다.</p>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  {papers.map(p => (
                    <div key={p.id} style={{ border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
                      <div style={{ padding:"8px 12px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0",
                        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ fontSize:13, fontWeight:600, color:"#1e293b" }}>{p.student_name}</span>
                        <span style={{ fontSize:11, color:"#94a3b8" }}>{new Date(p.submitted_at).toLocaleString("ko-KR")}</span>
                      </div>
                      <img src={p.image_url} alt="시험지"
                        style={{ width:"100%", display:"block", cursor:"pointer" }}
                        onClick={() => window.open(p.image_url, "_blank")} />
                      <div style={{ padding:"6px 12px", fontSize:11, color:"#94a3b8", textAlign:"center" }}>
                        클릭하면 원본 이미지가 열립니다
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 시험 일정 입력 모달 ── */}
      {showForm && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:300,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:14, padding:24, width:"100%", maxWidth:520,
            maxHeight:"90vh", overflowY:"auto", boxShadow:"0 8px 40px rgba(0,0,0,0.2)" }}>
            <h3 style={{ margin:"0 0 16px", color:"#7c3aed" }}>
              {editingExam ? "✏️ 시험 일정 수정" : " 시험 일정 추가"}
            </h3>
            <label style={{ fontSize:13, fontWeight:600 }}>학생</label>
            <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, marginBottom:10 }}>
              <option value="">학생 선택</option>
              {activeRoster.map(r => (
                <option key={r.studentCode} value={r.studentCode}>{r.name} ({r.school})</option>
              ))}
            </select>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>학기</label>
                <select value={form.semester} onChange={e => setForm({...form, semester: e.target.value as "1"|"2"})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
                  <option value="1">1학기</option>
                  <option value="2">2학기</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>시험 종류</label>
                <select value={form.examType} onChange={e => setForm({...form, examType: e.target.value as "midterm"|"final"})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
                  <option value="midterm">중간고사</option>
                  <option value="final">기말고사</option>
                </select>
              </div>
            </div>
            <label style={{ fontSize:13, fontWeight:600 }}>과목명</label>
            <input value={form.subject} onChange={e => setForm({...form, subject: e.target.value})} placeholder="영어"
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, marginBottom:10, boxSizing:"border-box" as const }} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>시험 시작일</label>
                <input type="date" value={form.examStart} onChange={e => setForm({...form, examStart: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>시험 종료일</label>
                <input type="date" value={form.examEnd} onChange={e => setForm({...form, examEnd: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
            </div>
            <label style={{ fontSize:13, fontWeight:600 }}>영어 시험일 ★</label>
            <input type="date" value={form.englishExamDate} onChange={e => setForm({...form, englishExamDate: e.target.value})}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #7c3aed", fontSize:13, marginBottom:10, boxSizing:"border-box" as const }} />
            <label style={{ fontSize:13, fontWeight:600 }}>시험 범위</label>
            <textarea value={form.examRange} onChange={e => setForm({...form, examRange: e.target.value})}
              placeholder="예) 교과서 1~3과, 부교재 Unit 1-5" rows={2}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, resize:"none" as const, marginBottom:10, boxSizing:"border-box" as const }} />
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>직보일</label>
                <input type="date" value={form.reportDeadline} onChange={e => setForm({...form, reportDeadline: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
              <div>
                <label style={{ fontSize:13, fontWeight:600 }}>다음 수업 예정일</label>
                <input type="date" value={form.nextLessonDate} onChange={e => setForm({...form, nextLessonDate: e.target.value})}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
              </div>
            </div>
            <label style={{ fontSize:13, fontWeight:600 }}>메모</label>
            <textarea value={form.memo} onChange={e => setForm({...form, memo: e.target.value})} placeholder="추가 메모" rows={2}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, resize:"none" as const, marginBottom:16, boxSizing:"border-box" as const }} />
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={addOrUpdateExam}
                style={{ flex:1, padding:11, borderRadius:8, border:"none", background:"#7c3aed", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                {editingExam ? "수정 저장" : "추가"}
              </button>
              <button onClick={() => { setShowForm(false); setEditingExam(null); }}
                style={{ flex:1, padding:11, borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", fontSize:14, cursor:"pointer" }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      )} {/* end admin view */}
    </div>
  );
}


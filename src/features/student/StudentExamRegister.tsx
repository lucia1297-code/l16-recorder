import { Calendar, MessageSquare, Send, CheckCircle, XCircle, Clock, PlusCircle } from "lucide-react";
import { useEffect, useState } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const SB_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

interface StudentExam {
  id?: string;
  student_code: string;
  student_name: string;
  semester: "1" | "2";
  exam_type: "midterm" | "final";
  subject: string;
  exam_start: string;
  exam_end: string;
  english_exam_date: string;
  exam_range: string;
  report_deadline: string;
  exam_paper_submitted: boolean;
  next_lesson_date: string;
  memo: string;
  admin_confirmed?: boolean;
}

interface ConsultationMessage {
  id?: string;
  student_code: string;
  student_name: string;
  message: string;
  created_at?: string;
  admin_reply?: string;
  replied_at?: string;
  is_read?: boolean;
}

const EMPTY_EXAM: Omit<StudentExam, "student_code" | "student_name"> = {
  semester: "2",
  exam_type: "final",
  subject: "영어",
  exam_start: "",
  exam_end: "",
  english_exam_date: "",
  exam_range: "",
  report_deadline: "",
  exam_paper_submitted: false,
  next_lesson_date: "",
  memo: "",
};

export default function StudentExamRegister({
  studentCode,
  studentName,
}: {
  studentCode: string;
  studentName: string;
}) {
  const [tab, setTab] = useState<"exam" | "consult">("exam");
  const [exams, setExams] = useState<StudentExam[]>([]);
  const [msgs, setMsgs] = useState<ConsultationMessage[]>([]);
  const [form, setForm] = useState(EMPTY_EXAM);
  const [newMsg, setNewMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [e, m] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/student_exams?student_code=eq.${studentCode}&order=submitted_at.desc`, { headers: SB_HEADERS }).then(r => r.json()),
        fetch(`${SUPABASE_URL}/rest/v1/consultation_messages?student_code=eq.${studentCode}&order=created_at.desc`, { headers: SB_HEADERS }).then(r => r.json()),
      ]);
      setExams(Array.isArray(e) ? e : []);
      setMsgs(Array.isArray(m) ? m : []);
    } catch { setError("데이터 로딩 실패"); }
    setLoading(false);
  }

  async function submitExam() {
    if (!form.english_exam_date) { setError("영어 시험일은 필수입니다."); return; }
    setSubmitting(true); setError("");
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/student_exams`, {
        method: "POST",
        headers: { ...SB_HEADERS, "Prefer": "return=representation" },
        body: JSON.stringify({ ...form, student_code: studentCode, student_name: studentName }),
      });
      if (!res.ok) throw new Error(await res.text());
      setNotice("시험 일정이 등록됐습니다."); setShowForm(false); setForm(EMPTY_EXAM);
      loadAll(); setTimeout(() => setNotice(""), 3000);
    } catch(e) { setError("등록 실패: " + (e as Error).message); }
    setSubmitting(false);
  }

  async function submitMsg() {
    if (!newMsg.trim()) return;
    setSubmitting(true);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/consultation_messages`, {
        method: "POST",
        headers: SB_HEADERS,
        body: JSON.stringify({ student_code: studentCode, student_name: studentName, message: newMsg }),
      });
      setNewMsg(""); setNotice("메시지를 보냈습니다.");
      loadAll(); setTimeout(() => setNotice(""), 3000);
    } catch(e) { setError("발송 실패: " + (e as Error).message); }
    setSubmitting(false);
  }

  function daysLeft(dateStr: string) {
    if (!dateStr) return null;
    const d = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
    return d;
  }

  return (
    <div style={{ padding: "0 0 24px" }}>
      {/* 탭 */}
      <div style={{ display:"flex", gap:8, marginBottom:16 }}>
        {([
          { key:"exam", label:"시험 등록" },
          { key:"consult", label:"상담 메시지" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding:"8px 18px", borderRadius:10, border:"none", fontWeight:700, fontSize:13,
              cursor:"pointer", background: tab===t.key ? "#7c3aed" : "#f1f5f9",
              color: tab===t.key ? "#fff" : "#64748b" }}>
            {t.label}
          </button>
        ))}
      </div>

      {notice && <p style={{ color:"#059669", fontWeight:600, marginBottom:10 }}>{notice}</p>}
      {error && <p style={{ color:"#ef4444", marginBottom:10 }}>{error}</p>}

      {/* ── 시험 등록 탭 ── */}
      {tab === "exam" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <p style={{ fontSize:13, color:"#64748b" }}>내 시험 일정을 등록하면 선생님이 확인하십니다.</p>
            <button onClick={() => { setShowForm(true); setForm(EMPTY_EXAM); }}
              style={{ padding:"7px 16px", borderRadius:8, border:"none", background:"#7c3aed",
                color:"#fff", fontWeight:700, fontSize:13, cursor:"pointer" }}>
              + 시험 등록
            </button>
          </div>

          {/* 등록 폼 */}
          {showForm && (
            <div style={{ border:"1.5px solid #7c3aed", borderRadius:12, padding:18, marginBottom:16, background:"#faf5ff" }}>
              <h4 style={{ color:"#7c3aed", margin:"0 0 14px" }}>시험 일정 등록</h4>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:600 }}>학기</label>
                  <select value={form.semester} onChange={e => setForm({...form, semester: e.target.value as "1"|"2"})}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
                    <option value="1">1학기</option>
                    <option value="2">2학기</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:600 }}>시험 종류</label>
                  <select value={form.exam_type} onChange={e => setForm({...form, exam_type: e.target.value as "midterm"|"final"})}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }}>
                    <option value="midterm">중간고사</option>
                    <option value="final">기말고사</option>
                  </select>
                </div>
              </div>
              <label style={{ fontSize:12, fontWeight:600 }}>과목</label>
              <input value={form.subject} onChange={e => setForm({...form, subject: e.target.value})}
                style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, marginBottom:10, boxSizing:"border-box" as const }} />
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:600 }}>시험 시작일</label>
                  <input type="date" value={form.exam_start} onChange={e => setForm({...form, exam_start: e.target.value})}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:600 }}>시험 종료일</label>
                  <input type="date" value={form.exam_end} onChange={e => setForm({...form, exam_end: e.target.value})}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
                </div>
              </div>
              <label style={{ fontSize:12, fontWeight:700, color:"#7c3aed" }}>영어 시험일 ★ (필수)</label>
              <input type="date" value={form.english_exam_date} onChange={e => setForm({...form, english_exam_date: e.target.value})}
                style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #7c3aed", fontSize:13, marginBottom:10, boxSizing:"border-box" as const }} />
              <label style={{ fontSize:12, fontWeight:600 }}>시험 범위</label>
              <textarea value={form.exam_range} onChange={e => setForm({...form, exam_range: e.target.value})}
                placeholder="예) 교과서 1~3과, 부교재 Unit 1-5" rows={2}
                style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, resize:"none" as const, marginBottom:10, boxSizing:"border-box" as const }} />
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:600 }}>직보일 (성적 전달일)</label>
                  <input type="date" value={form.report_deadline} onChange={e => setForm({...form, report_deadline: e.target.value})}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:600 }}>다음 수업 예정일</label>
                  <input type="date" value={form.next_lesson_date} onChange={e => setForm({...form, next_lesson_date: e.target.value})}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13 }} />
                </div>
              </div>
              <label style={{ fontSize:12, fontWeight:600, display:"flex", alignItems:"center", gap:8, marginBottom:10, cursor:"pointer" }}>
                <input type="checkbox" checked={form.exam_paper_submitted}
                  onChange={e => setForm({...form, exam_paper_submitted: e.target.checked})}
                  style={{ width:16, height:16 }} />
                시험지 제출 완료
              </label>
              <label style={{ fontSize:12, fontWeight:600 }}>메모</label>
              <textarea value={form.memo} onChange={e => setForm({...form, memo: e.target.value})} rows={2}
                style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:13, resize:"none" as const, marginBottom:14, boxSizing:"border-box" as const }} />
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={submitExam} disabled={submitting}
                  style={{ flex:1, padding:11, borderRadius:8, border:"none", background:"#7c3aed",
                    color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                  {submitting ? "등록 중…" : "등록하기"}
                </button>
                <button onClick={() => setShowForm(false)}
                  style={{ flex:1, padding:11, borderRadius:8, border:"1px solid #e2e8f0", background:"#fff", fontSize:14, cursor:"pointer" }}>
                  취소
                </button>
              </div>
            </div>
          )}

          {/* 등록된 시험 목록 */}
          {loading ? <p style={{ color:"#94a3b8" }}>로딩 중…</p> :
           exams.length === 0 ? <p style={{ color:"#94a3b8", textAlign:"center", padding:"24px 0" }}>등록된 시험이 없습니다.</p> : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {exams.map((ex, i) => {
                const dl = daysLeft(ex.english_exam_date);
                const urgent = dl !== null && dl >= 0 && dl <= 7;
                return (
                  <div key={i} style={{ border:`1.5px solid ${urgent?"#fca5a5":ex.admin_confirmed?"#86efac":"#e2e8f0"}`,
                    borderRadius:12, overflow:"hidden", background: urgent?"#fff5f5":ex.admin_confirmed?"#f0fdf4":"#fff" }}>
                    <div style={{ padding:"10px 14px", background: urgent?"#fee2e2":ex.admin_confirmed?"#d1fae5":"#f8fafc",
                      borderBottom:"1px solid #f1f5f9", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:6 }}>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ fontWeight:700, fontSize:14 }}>{ex.subject}</span>
                        <span style={{ fontSize:11, background:"#ede9fe", color:"#7c3aed", padding:"1px 7px", borderRadius:8, fontWeight:600 }}>
                          {ex.semester}학기 {ex.exam_type==="midterm"?"중간":"기말"}
                        </span>
                        {dl !== null && dl >= 0 && (
                          <span style={{ fontSize:12, fontWeight:700, color: urgent?"#dc2626":"#f97316" }}>D-{dl}</span>
                        )}
                        {ex.admin_confirmed && <span style={{ fontSize:11, color:"#059669", fontWeight:600 }}><CheckCircle size={11} style={{verticalAlign:"middle",marginRight:3}} color="#059669"/> 선생님 확인</span>}
                      </div>
                    </div>
                    <div style={{ padding:"10px 14px", display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(140px,1fr))", gap:"6px 12px", fontSize:12 }}>
                      {[
                        { label:"시험 기간", value: ex.exam_start && ex.exam_end ? `${ex.exam_start.slice(5)} ~ ${ex.exam_end.slice(5)}` : "-" },
                        { label:"영어 시험일", value: ex.english_exam_date ? ex.english_exam_date.slice(5) : "-" },
                        { label:"직보일", value: ex.report_deadline ? ex.report_deadline.slice(5) : "-" },
                        { label:"다음 수업", value: ex.next_lesson_date ? ex.next_lesson_date.slice(5) : "-" },
                        { label:"시험 범위", value: ex.exam_range || "-" },
                        { label:"시험지 제출", value: ex.exam_paper_submitted ? "✅ 완료" : "미제출" },
                      ].map(it => (
                        <div key={it.label}>
                          <div style={{ fontSize:10, color:"#94a3b8", fontWeight:600 }}>{it.label}</div>
                          <div style={{ color:"#374151", fontWeight:500 }}>{it.value}</div>
                        </div>
                      ))}
                    </div>
                    {ex.memo && (
                      <div style={{ padding:"6px 14px 10px", fontSize:12, color:"#64748b" }}>
                        메모: {ex.memo}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── 상담 메시지 탭 ── */}
      {tab === "consult" && (
        <div>
          <p style={{ fontSize:13, color:"#64748b", marginBottom:14 }}>
            선생님께 궁금한 점이나 하고 싶은 말을 남겨주세요.
          </p>
          {/* 메시지 작성 */}
          <div style={{ border:"1px solid #e2e8f0", borderRadius:10, padding:14, marginBottom:16, background:"#f8fafc" }}>
            <textarea value={newMsg} onChange={e => setNewMsg(e.target.value)}
              placeholder="선생님께 드리고 싶은 말씀을 작성해주세요."
              rows={4}
              style={{ width:"100%", padding:"10px", borderRadius:8, border:"1px solid #e2e8f0",
                fontSize:13, resize:"none" as const, boxSizing:"border-box" as const, marginBottom:10 }} />
            <button onClick={submitMsg} disabled={submitting || !newMsg.trim()}
              style={{ width:"100%", padding:11, borderRadius:8, border:"none",
                background: submitting || !newMsg.trim() ? "#e2e8f0" : "#7c3aed",
                color: submitting || !newMsg.trim() ? "#94a3b8" : "#fff",
                fontWeight:700, fontSize:14, cursor: submitting || !newMsg.trim() ? "not-allowed" : "pointer" }}>
              {submitting ? "발송 중…" : "선생님께 보내기"}
            </button>
          </div>

          {/* 메시지 이력 */}
          {loading ? <p style={{ color:"#94a3b8" }}>로딩 중…</p> :
           msgs.length === 0 ? <p style={{ color:"#94a3b8", textAlign:"center", padding:"20px 0" }}>보낸 메시지가 없습니다.</p> : (
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ border:"1px solid #e2e8f0", borderRadius:12, overflow:"hidden" }}>
                  {/* 학생 메시지 */}
                  <div style={{ padding:"12px 14px", background:"#fff" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:11, fontWeight:600, color:"#7c3aed" }}>내가 보낸 메시지</span>
                      <span style={{ fontSize:10, color:"#94a3b8" }}>{m.created_at?.slice(0,10)}</span>
                    </div>
                    <p style={{ fontSize:13, color:"#374151", margin:0, whiteSpace:"pre-wrap" }}>{m.message}</p>
                  </div>
                  {/* 선생님 답변 */}
                  {m.admin_reply ? (
                    <div style={{ padding:"12px 14px", background:"#f0fdf4", borderTop:"1px solid #e2e8f0" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                        <span style={{ fontSize:11, fontWeight:600, color:"#059669" }}>✅ 선생님 답변</span>
                        <span style={{ fontSize:10, color:"#94a3b8" }}>{m.replied_at?.slice(0,10)}</span>
                      </div>
                      <p style={{ fontSize:13, color:"#166534", margin:0, whiteSpace:"pre-wrap" }}>{m.admin_reply}</p>
                    </div>
                  ) : (
                    <div style={{ padding:"8px 14px", background:"#f8fafc", borderTop:"1px solid #f1f5f9" }}>
                      <span style={{ fontSize:11, color:"#94a3b8" }}><Clock size={11} style={{verticalAlign:"middle",marginRight:3}}/> 선생님 답변 대기 중</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

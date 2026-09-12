import { useEffect, useState, useMemo, useRef } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import { createStorage } from "../../lib/storageFactory";
import { createAssignmentStore } from "../../lib/assignmentStoreFactory";
import type { RosterEntry } from "../../core/roster";
import type { ExamResult } from "../../core/types";
import type { AssignmentSubmission, AssignmentType } from "../../core/assignment";
import {
  User, ClipboardList, FileText, Save, Trash2,
  Edit2, CheckCircle, ChevronDown, ChevronUp, PlusCircle
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const EXAM_TYPES = [
  "3월 학력평가", "4월 학력평가", "5월 학력평가",
  "6월 모의평가", "7월 학력평가", "9월 모의평가",
  "10월 학력평가", "11월 수능", "학교 시험", "자체 시험", "기타",
];

const EXAM_PROVIDERS = [
  "EBS", "메가스터디", "대성", "강남구청", "강남교육청",
  "학교", "학원", "개인 강사",
];

const now = new Date();
// RFC4122 UUID v4 생성
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const EMPTY_EXAM = {
  id: "",
  examName: `${now.getFullYear()}년 ${now.getMonth()+1}월 학력평가`,
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  round: 1,
  date: now.toISOString().slice(0, 10),
  provider: "",
  score: "",
  wrongNos: "",
  memo: "",
};

const EMPTY_ASG = {
  id: "",
  typeId: "", round: 1, score: "",
  wrongNos: "", completed: true, totalMinutes: "", memo: "",
};

export default function AdminInputPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const storage    = useMemo(() => createStorage(), []);
  const asgStore   = useMemo(() => createAssignmentStore(), []);

  const [roster,   setRoster]   = useState<RosterEntry[]>([]);
  const [asgTypes, setAsgTypes] = useState<AssignmentType[]>([]);

  // ── 학생 선택 ──────────────────────────────────────
  const mountedRef = useRef(true);
  const [selectedCode, setSelectedCode] = useState("");
  const student = roster.find(r => r.studentCode === selectedCode);

  // ── 입력 탭 ────────────────────────────────────────
  const [inputTab, setInputTab] = useState<"exam"|"assignment">("exam");

  // ── 알림 ───────────────────────────────────────────
  const [notice, setNotice] = useState("");
  const [error,  setError]  = useState("");
  const [saving, setSaving]  = useState(false);

  // ── 모의고사 폼 ────────────────────────────────────
  const [examForm, setExamForm] = useState(EMPTY_EXAM);
  const [recentExams, setRecentExams] = useState<ExamResult[]>([]);

  // ── 과제 폼 ────────────────────────────────────────
  const [asgForm,  setAsgForm]  = useState(EMPTY_ASG);
  const [recentAsgs, setRecentAsgs] = useState<AssignmentSubmission[]>([]);

  // ── 초기 로드 ──────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    rosterStore.listRoster().then(r =>
      setRoster(r.filter(s => (s.studentStatus ?? "active") !== "withdrawn"))
    );
    asgStore.listTypes().then(t => { if (mountedRef.current) setAsgTypes(t); });
    return () => { mountedRef.current = false; };
  }, []);

  // ── 학생 선택 시 이력 로드 ─────────────────────────
  useEffect(() => {
    if (!selectedCode) return;
    storage.listResults().then(all =>
      setRecentExams(
        all.filter(r => r.student.studentCode === selectedCode)
           .sort((a, b) => b.date.localeCompare(a.date))
           .slice(0, 15)
      )
    );
    asgStore.listSubmissionsForStudent(selectedCode).then(all =>
      setRecentAsgs(
        all.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 15)
      )
    );
  }, [selectedCode]);

  function notify(msg: string) {
    setNotice(msg); setError("");
    setTimeout(() => setNotice(""), 4000);
  }
  function fail(msg: string) { setError(msg); setNotice(""); }

  // ── 모의고사 이력 클릭 시 폼에 로드 ───────────────────
  function editExam(ex: ExamResult) {
    setExamForm({
      id: ex.id,
      examName: ex.exam.examName,
      year: ex.exam.year,
      month: ex.exam.month,
      round: ex.exam.round,
      date: ex.date,
      provider: ex.exam.provider || "",
      score: String(ex.score),
      wrongNos: ex.wrongAnswers.map(w => w.questionNo).join(", "),
      memo: ex.reflection.hardestReason,
    });
    setInputTab("exam");
  }

  // ── 과제 이력 클릭 시 폼에 로드 ──────────────────────
  function editAsg(asg: AssignmentSubmission) {
    setAsgForm({
      id: asg.id,
      typeId: asg.typeId,
      round: asg.round,
      score: asg.score ? String(asg.score) : "",
      wrongNos: asg.wrongNumbers.join(", "),
      completed: asg.completed,
      totalMinutes: asg.totalMinutes ? String(asg.totalMinutes) : "",
      memo: asg.memo ?? "",
    });
    setInputTab("assignment");
  }

  // ── 모의고사 저장 (새로 입력 또는 수정) ──────────────
  async function saveExam() {
    if (!student) { fail("학생을 먼저 선택해주세요."); return; }
    const score = Number(examForm.score);
    if (!examForm.score || isNaN(score) || score < 0 || score > 100) {
      fail("점수를 올바르게 입력해주세요. (0~100)"); return;
    }
    setSaving(true);
    try {
      const wrongNos = examForm.wrongNos
        .split(/[,\s]+/).filter(Boolean).map(Number)
        .filter(n => !isNaN(n) && n > 0);

      const isUpdate = !!examForm.id;
      const result: ExamResult = {
        id: examForm.id || uuidv4(),
        student: {
          studentCode: student.studentCode,
          name: student.name,
          school: student.school ?? "",
          grade: student.grade ?? "",
        },
        exam: {
          examName: examForm.examName,
          year: examForm.year,
          month: examForm.month,
          round: examForm.round,
          totalQuestions: 45,
          maxScore: 100,
          provider: examForm.provider || undefined,
        },
        teacher: "관리자 직접 입력",
        date: examForm.date,
        score,
        wrongAnswers: wrongNos.map(n => ({
          questionNo: n, reasons: [], chosenOption: null,
        })),
        reflection: {
          hardestReason: examForm.memo,
          nextGoal: "", satisfaction: 0,
        },
        submittedAt: isUpdate ? new Date().toISOString() : new Date().toISOString(),
      };

      if (isUpdate) {
        const updateData = {
          exam_name: result.exam.examName,
          year: result.exam.year,
          month: result.exam.month,
          round: result.exam.round,
          provider: result.exam.provider ?? null,
          date: result.date,
          score: result.score,
          wrong_answers: result.wrongAnswers,
          reflection: result.reflection,
          submitted_at: result.submittedAt,
        };
        await fetch(`${SUPABASE_URL}/rest/v1/results?id=eq.${result.id}`, {
          method: "PATCH",
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }).then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        });
        notify(`✅ ${student.name} — ${examForm.examName} ${score}점 수정 완료`);
      } else {
        await storage.saveResult(result);
        notify(`✅ ${student.name} — ${examForm.examName} ${score}점 저장 완료`);
      }

      setExamForm(EMPTY_EXAM);
      storage.listResults().then(all =>
        setRecentExams(
          all.filter(r => r.student.studentCode === selectedCode)
             .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15)
        )
      );
    } catch(e: any) {
      const msg = e?.message ?? e?.details ?? (typeof e === "string" ? e : "알 수 없는 오류");
      fail(`저장 실패: ${msg} — 네트워크를 확인하고 다시 시도해주세요.`);
      console.error("[AdminInput] 모의고사 저장 오류:", e);
    }
    setSaving(false);
  }

  // ── 과제 저장 (새로 입력 또는 수정) ──────────────
  async function saveAsg() {
    if (!student) { fail("학생을 먼저 선택해주세요."); return; }
    if (!asgForm.typeId) { fail("과제 유형을 선택해주세요."); return; }
    setSaving(true);
    try {
      const wrongNos = asgForm.wrongNos
        .split(/[,\s]+/).filter(Boolean).map(Number)
        .filter(n => !isNaN(n) && n > 0);

      const isUpdate = !!asgForm.id;

      if (isUpdate) {
        // 수정: updateSubmission 사용
        await asgStore.updateSubmission(asgForm.id, {
          typeId: asgForm.typeId,
          round: asgForm.round,
          score: asgForm.score ? Number(asgForm.score) : null,
          wrongNumbers: wrongNos,
          completed: asgForm.completed,
          totalMinutes: asgForm.totalMinutes ? Number(asgForm.totalMinutes) : undefined,
          memo: asgForm.memo || undefined,
          submittedAt: new Date().toISOString(),
        });
        const typeName = asgTypes.find(t => t.id === asgForm.typeId)?.name ?? "";
        notify(`✅ ${student.name} — ${typeName} 수정 완료`);
      } else {
        // 새로 입력: submit 사용
        const entry: AssignmentSubmission = {
          id: uuidv4(),
          studentCode: selectedCode,
          typeId: asgForm.typeId,
          round: asgForm.round,
          score: asgForm.score ? Number(asgForm.score) : null,
          wrongNumbers: wrongNos,
          completed: asgForm.completed,
          totalMinutes: asgForm.totalMinutes ? Number(asgForm.totalMinutes) : undefined,
          memo: asgForm.memo || undefined,
          submittedAt: new Date().toISOString(),
        };
        await asgStore.submit(entry);
        const typeName = asgTypes.find(t => t.id === asgForm.typeId)?.name ?? "";
        notify(`✅ ${student.name} — ${typeName} 저장 완료`);
      }

      setAsgForm(EMPTY_ASG);
      asgStore.listSubmissionsForStudent(selectedCode).then(all =>
        setRecentAsgs(
          all.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 15)
        )
      );
    } catch(e: any) {
      const msg = e?.message ?? e?.details ?? JSON.stringify(e) ?? "알 수 없는 오류";
      fail("저장 실패: " + msg);
      console.error("[AdminInput] 과제 저장 오류:", e);
    }
    setSaving(false);
  }

  // ── 모의고사 삭제 ───────────────────────────────────
  async function deleteExam(id: string) {
    if (!confirm("이 모의고사 기록을 삭제하시겠습니까?")) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/results?id=eq.${id}`, {
        method: "DELETE",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRecentExams(prev => prev.filter(r => r.id !== id));
      notify("삭제됐습니다.");
    } catch(e: any) {
      fail("삭제 실패: " + (e?.message ?? "네트워크 오류"));
    }
  }

  // ── 렌더링 ─────────────────────────────────────────
  return (
    <div className="card">

      {/* 헤더 */}
      <h2 style={{ margin:"0 0 18px", color:"#7c3aed",
        display:"flex", alignItems:"center", gap:8 }}>
        <Edit2 size={20} color="#7c3aed"/> 관리자 직접 입력
      </h2>

      {/* 알림 */}
      {notice && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:14,
          background:"#f0fdf4", border:"1px solid #86efac",
          color:"#166534", fontWeight:600, fontSize:13 }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:14,
          background:"#fef2f2", border:"1px solid #fca5a5",
          color:"#dc2626", fontSize:13 }}>
          {error}
        </div>
      )}

      {/* ── STEP 1: 학생 선택 ───────────────────────── */}
      <div style={{ marginBottom:20, padding:16,
        background:"#f5f3ff", borderRadius:12,
        border: selectedCode ? "2px solid #7c3aed" : "2px dashed #c4b5fd" }}>
        <div style={{ fontSize:12, fontWeight:700, color:"#7c3aed",
          marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
          <User size={14}/> STEP 1 — 학생 선택
        </div>
        <select value={selectedCode}
          onChange={e => { setSelectedCode(e.target.value); setError(""); }}
          style={{ width:"100%", padding:"12px 14px", borderRadius:10,
            border:"1.5px solid #7c3aed", fontSize:16, fontWeight:700,
            background:"#fff", color: selectedCode ? "#1e293b" : "#94a3b8",
            boxSizing:"border-box" as const }}>
          <option value="">── 학생을 선택하세요 ──</option>
          {roster.map(r => (
            <option key={r.studentCode} value={r.studentCode}>
              {r.name}　{r.school} {r.grade}학년
            </option>
          ))}
        </select>
        {student && (
          <div style={{ display:"flex", gap:10, marginTop:10, flexWrap:"wrap" }}>
            <span style={{ fontSize:13, fontWeight:700, color:"#7c3aed" }}>
              {student.name}
            </span>
            <span style={{ fontSize:12, color:"#64748b" }}>
              {student.school} {student.grade}학년
            </span>
            {student.phone && (
              <span style={{ fontSize:12, color:"#64748b" }}>
                {student.phone}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── STEP 2: 입력 내용 선택 ─────────────────── */}
      {selectedCode && (
        <>
          <div style={{ fontSize:12, fontWeight:700, color:"#7c3aed",
            marginBottom:10, display:"flex", alignItems:"center", gap:6 }}>
            <ClipboardList size={14}/> STEP 2 — 입력 항목 선택
          </div>

          {/* 탭 */}
          <div style={{ display:"flex", gap:8, marginBottom:20, flexWrap:"wrap" }}>
            {([
              { key:"exam",       label:"모의고사 점수", icon:<ClipboardList size={15}/> },
              { key:"assignment", label:"과제 결과",      icon:<FileText size={15}/> },
            ] as const).map(t => (
              <button key={t.key} onClick={() => { setInputTab(t.key); setError(""); }}
                style={{ flex:1, minWidth:140, padding:"12px 16px",
                  borderRadius:10, border:"none", fontSize:14, fontWeight:700,
                  cursor:"pointer", display:"flex", alignItems:"center",
                  justifyContent:"center", gap:6,
                  background: inputTab===t.key ? "#7c3aed" : "#f1f5f9",
                  color: inputTab===t.key ? "#fff" : "#64748b",
                  boxShadow: inputTab===t.key ? "0 2px 8px rgba(124,58,237,0.3)" : "none" }}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* ── 모의고사 점수 입력 ── */}
          {inputTab === "exam" && (
            <div style={{ border:"1.5px solid #e0e7ff", borderRadius:14,
              padding:20, background:"#fafafe", marginBottom:20 }}>
              <h3 style={{ margin:"0 0 16px", fontSize:15,
                fontWeight:700, color:"#4338ca" }}>
                모의고사 점수 입력
              </h3>

              {/* 시험 종류 + 날짜 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
                gap:12, marginBottom:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>
                    시험 종류
                  </label>
                  <select value={examForm.examName}
                    onChange={e => setExamForm({...examForm, examName: e.target.value})}
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1.5px solid #c4b5fd", fontSize:13,
                      boxSizing:"border-box" as const }}>
                    {EXAM_TYPES.map(t => (
                      <option key={t} value={`${examForm.year}년 ${t}`}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>
                    시험 날짜
                  </label>
                  <input type="date" value={examForm.date}
                    onChange={e => setExamForm({...examForm, date: e.target.value})}
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1.5px solid #c4b5fd", fontSize:13,
                      boxSizing:"border-box" as const }} />
                </div>
              </div>

              {/* 시행처 */}
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:12, fontWeight:600,
                  display:"block", marginBottom:5, color:"#374151" }}>
                  시행처
                </label>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
                  gap:12, marginBottom:6 }}>
                  <select value={examForm.provider}
                    onChange={e => setExamForm({...examForm, provider: e.target.value})}
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1.5px solid #c4b5fd", fontSize:13,
                      boxSizing:"border-box" as const, background:"#fff",
                      cursor:"pointer" }}>
                    <option value="">── 빠른 선택 ──</option>
                    {EXAM_PROVIDERS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <input type="text"
                  value={examForm.provider}
                  onChange={e => setExamForm({...examForm, provider: e.target.value})}
                  placeholder="직접 입력 (예: 강남학원, 천재교육 등)"
                  style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                    border:"1.5px solid #c4b5fd", fontSize:13,
                    boxSizing:"border-box" as const }} />
              </div>

              {/* 점수 — 강조 */}
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:13, fontWeight:700,
                  display:"block", marginBottom:8, color:"#374151" }}>
                  점수 *
                </label>
                <input type="number" min={0} max={100}
                  value={examForm.score}
                  onChange={e => setExamForm({...examForm, score: e.target.value})}
                  placeholder="0 ~ 100"
                  style={{ width:"100%", padding:"16px", borderRadius:12,
                    border:"2.5px solid #7c3aed", fontSize:36, fontWeight:800,
                    textAlign:"center", color:"#7c3aed", background:"#fff",
                    boxSizing:"border-box" as const }} />
              </div>

              {/* 연도 + 회차 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
                gap:12, marginBottom:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>연도</label>
                  <input type="number" value={examForm.year}
                    onChange={e => setExamForm({...examForm, year: Number(e.target.value)})}
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13,
                      boxSizing:"border-box" as const }} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>회차</label>
                  <input type="number" min={1} value={examForm.round}
                    onChange={e => setExamForm({...examForm, round: Number(e.target.value)})}
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13,
                      boxSizing:"border-box" as const }} />
                </div>
              </div>

              {/* 틀린 문항 */}
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:12, fontWeight:600,
                  display:"block", marginBottom:5, color:"#374151" }}>
                  틀린 문항 번호 (쉼표·공백 구분)
                </label>
                <input value={examForm.wrongNos}
                  onChange={e => setExamForm({...examForm, wrongNos: e.target.value})}
                  placeholder="예) 3, 7, 12, 25, 31"
                  style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                    border:"1px solid #e2e8f0", fontSize:13,
                    boxSizing:"border-box" as const }} />
              </div>

              {/* 메모 */}
              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:12, fontWeight:600,
                  display:"block", marginBottom:5, color:"#374151" }}>
                  메모 (선택)
                </label>
                <textarea value={examForm.memo}
                  onChange={e => setExamForm({...examForm, memo: e.target.value})}
                  placeholder="특이사항, 컨디션, 강사 코멘트 등"
                  rows={2}
                  style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                    border:"1px solid #e2e8f0", fontSize:13,
                    resize:"none" as const, boxSizing:"border-box" as const }} />
              </div>

              {/* 저장 */}
              <button onClick={saveExam} disabled={saving}
                style={{ width:"100%", padding:"14px", borderRadius:10,
                  border:"none", fontSize:16, fontWeight:800, cursor:"pointer",
                  background: saving ? "#e2e8f0" : "#7c3aed",
                  color: saving ? "#94a3b8" : "#fff",
                  display:"flex", alignItems:"center",
                  justifyContent:"center", gap:8 }}>
                <Save size={18}/>
                {saving ? "저장 중…" : examForm.id ? `${student?.name} 점수 수정` : `${student?.name} 점수 저장`}
              </button>

              {/* 최근 이력 */}
              {recentExams.length > 0 && (
                <div style={{ marginTop:20 }}>
                  <p style={{ fontSize:12, fontWeight:700,
                    color:"#64748b", marginBottom:8 }}>
                    최근 제출 이력
                  </p>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {recentExams.map(ex => (
                      <div key={ex.id}
                        style={{ display:"flex", alignItems:"center",
                          justifyContent:"space-between",
                          padding:"9px 12px", borderRadius:8,
                          border:"1px solid #e2e8f0", background:"#fff",
                          flexWrap:"wrap", gap:6 }}>
                        <div style={{ display:"flex", alignItems:"center",
                          gap:10, flexWrap:"wrap" }}>
                          <span style={{ fontSize:15, fontWeight:800,
                            color: ex.score >= 90 ? "#059669"
                                 : ex.score >= 70 ? "#2563eb" : "#ef4444" }}>
                            {ex.score}점
                          </span>
                          <span style={{ fontSize:12, color:"#475569" }}>
                            {ex.exam.examName}
                          </span>
                          {ex.exam.provider && (
                            <span style={{ fontSize:11, color:"#7c3aed", fontWeight:600 }}>
                              ({ex.exam.provider})
                            </span>
                          )}
                          <span style={{ fontSize:11, color:"#94a3b8" }}>
                            {ex.date}
                          </span>
                          {ex.teacher === "관리자 직접 입력" && (
                            <span style={{ fontSize:10, padding:"1px 6px",
                              borderRadius:4, background:"#ede9fe",
                              color:"#7c3aed", fontWeight:600 }}>
                              관리자
                            </span>
                          )}
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={() => editExam(ex)}
                            style={{ display:"flex", alignItems:"center", gap:3,
                              padding:"4px 10px", borderRadius:6,
                              border:"1px solid #c4b5fd", background:"#fff",
                              color:"#7c3aed", fontSize:11, cursor:"pointer" }}>
                            <Edit2 size={11}/> 수정
                          </button>
                          <button onClick={() => deleteExam(ex.id)}
                            style={{ display:"flex", alignItems:"center", gap:3,
                              padding:"4px 10px", borderRadius:6,
                              border:"1px solid #fca5a5", background:"#fff",
                              color:"#ef4444", fontSize:11, cursor:"pointer" }}>
                            <Trash2 size={11}/> 삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 과제 결과 입력 ── */}
          {inputTab === "assignment" && (
            <div style={{ border:"1.5px solid #d1fae5", borderRadius:14,
              padding:20, background:"#f8fff9", marginBottom:20 }}>
              <h3 style={{ margin:"0 0 16px", fontSize:15,
                fontWeight:700, color:"#065f46" }}>
                과제 결과 입력
              </h3>

              {/* 과제 유형 */}
              <div style={{ marginBottom:12 }}>
                <label style={{ fontSize:13, fontWeight:700,
                  display:"block", marginBottom:6, color:"#374151" }}>
                  과제 유형 *
                </label>
                <select value={asgForm.typeId}
                  onChange={e => setAsgForm({...asgForm, typeId: e.target.value})}
                  style={{ width:"100%", padding:"12px 14px", borderRadius:10,
                    border:"2px solid #6ee7b7", fontSize:15, fontWeight:600,
                    background:"#fff", boxSizing:"border-box" as const }}>
                  <option value="">── 과제 유형 선택 ──</option>
                  {asgTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* 회차 + 점수 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
                gap:12, marginBottom:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>
                    회차
                  </label>
                  <input type="number" min={1} value={asgForm.round}
                    onChange={e => setAsgForm({...asgForm, round: Number(e.target.value)})}
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13,
                      boxSizing:"border-box" as const }} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>
                    점수 (선택)
                  </label>
                  <input type="number" value={asgForm.score}
                    onChange={e => setAsgForm({...asgForm, score: e.target.value})}
                    placeholder="예) 85"
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13,
                      boxSizing:"border-box" as const }} />
                </div>
              </div>

              {/* 틀린 문항 + 소요시간 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
                gap:12, marginBottom:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>
                    틀린 문항 번호
                  </label>
                  <input value={asgForm.wrongNos}
                    onChange={e => setAsgForm({...asgForm, wrongNos: e.target.value})}
                    placeholder="예) 3, 7, 15"
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13,
                      boxSizing:"border-box" as const }} />
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:600,
                    display:"block", marginBottom:5, color:"#374151" }}>
                    소요 시간 (분)
                  </label>
                  <input type="number" value={asgForm.totalMinutes}
                    onChange={e => setAsgForm({...asgForm, totalMinutes: e.target.value})}
                    placeholder="예) 40"
                    style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13,
                      boxSizing:"border-box" as const }} />
                </div>
              </div>

              {/* 완료 여부 + 메모 */}
              <div style={{ marginBottom:16,
                display:"flex", alignItems:"center", gap:12 }}>
                <label style={{ display:"flex", alignItems:"center", gap:8,
                  fontSize:14, fontWeight:600, cursor:"pointer" }}>
                  <input type="checkbox" checked={asgForm.completed}
                    onChange={e => setAsgForm({...asgForm, completed: e.target.checked})}
                    style={{ width:18, height:18 }} />
                  완료됨
                </label>
              </div>

              <div style={{ marginBottom:16 }}>
                <label style={{ fontSize:12, fontWeight:600,
                  display:"block", marginBottom:5, color:"#374151" }}>
                  메모 (선택)
                </label>
                <textarea value={asgForm.memo}
                  onChange={e => setAsgForm({...asgForm, memo: e.target.value})}
                  placeholder="특이사항, 강사 코멘트 등"
                  rows={2}
                  style={{ width:"100%", padding:"9px 11px", borderRadius:8,
                    border:"1px solid #e2e8f0", fontSize:13,
                    resize:"none" as const, boxSizing:"border-box" as const }} />
              </div>

              {/* 저장 */}
              <button onClick={saveAsg} disabled={saving}
                style={{ width:"100%", padding:"14px", borderRadius:10,
                  border:"none", fontSize:16, fontWeight:800, cursor:"pointer",
                  background: saving ? "#e2e8f0" : "#059669",
                  color: saving ? "#94a3b8" : "#fff",
                  display:"flex", alignItems:"center",
                  justifyContent:"center", gap:8 }}>
                <Save size={18}/>
                {saving ? "저장 중…" : asgForm.id ? `${student?.name} 과제 수정` : `${student?.name} 과제 저장`}
              </button>

              {/* 최근 이력 */}
              {recentAsgs.length > 0 && (
                <div style={{ marginTop:20 }}>
                  <p style={{ fontSize:12, fontWeight:700,
                    color:"#64748b", marginBottom:8 }}>
                    최근 제출 이력
                  </p>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {recentAsgs.map((asg, i) => {
                      const type = asgTypes.find(t => t.id === asg.typeId);
                      return (
                        <div key={i}
                          style={{ padding:"9px 12px", borderRadius:8,
                            border:"1px solid #e2e8f0", background:"#fff",
                            display:"flex", alignItems:"center",
                            justifyContent:"space-between",
                            flexWrap:"wrap", gap:6 }}>
                          <div style={{ display:"flex", alignItems:"center",
                            gap:10, flexWrap:"wrap" }}>
                            <span style={{ fontSize:13, fontWeight:700,
                              color:"#1e293b" }}>
                              {type?.name ?? asg.typeId}
                            </span>
                            <span style={{ fontSize:11, color:"#64748b" }}>
                              {asg.round}회차
                            </span>
                            {asg.score != null && (
                              <span style={{ fontSize:13, fontWeight:700,
                                color: asg.score >= 90 ? "#059669"
                                     : asg.score >= 70 ? "#2563eb" : "#ef4444" }}>
                                {asg.score}점
                              </span>
                            )}
                            {asg.completed && (
                              <CheckCircle size={13} color="#059669"/>
                            )}
                            <span style={{ fontSize:11, color:"#94a3b8" }}>
                              {asg.submittedAt.slice(0, 10)}
                            </span>
                          </div>
                          <button onClick={() => editAsg(asg)}
                            style={{ display:"flex", alignItems:"center", gap:3,
                              padding:"4px 10px", borderRadius:6,
                              border:"1px solid #c4b5fd", background:"#fff",
                              color:"#059669", fontSize:11, cursor:"pointer" }}>
                            <Edit2 size={11}/> 수정
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 학생 미선택 안내 */}
      {!selectedCode && (
        <div style={{ textAlign:"center", padding:"50px 20px", color:"#94a3b8" }}>
          <User size={48} color="#e2e8f0" style={{ marginBottom:12 }}/>
          <p style={{ fontSize:16, fontWeight:600, color:"#cbd5e1" }}>
            위에서 학생을 선택하세요
          </p>
          <p style={{ fontSize:13, marginTop:6 }}>
            모의고사 점수와 과제 결과를 직접 입력할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  );
}

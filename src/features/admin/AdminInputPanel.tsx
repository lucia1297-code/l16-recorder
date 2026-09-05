import { useEffect, useState, useMemo } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import { createStorage } from "../../lib/storageFactory";
import { createAssignmentStore } from "../../lib/assignmentStoreFactory";
import type { RosterEntry } from "../../core/roster";
import type { ExamResult } from "../../core/types";
import type { AssignmentSubmission, AssignmentType } from "../../core/assignment";
import {
  PlusCircle, Save, ClipboardList, FileText,
  ChevronDown, ChevronUp, Trash2, Edit2, CheckCircle
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

// ── 모의고사 입력 기본값 ─────────────────────────────
const EXAM_TYPES = [
  "3월 고1", "3월 고2", "3월 고3",
  "4월 고3", "5월 고3",
  "6월 모평", "7월 고1", "7월 고2", "7월 고3",
  "9월 모평", "10월 고3",
  "11월 수능", "학교 시험", "자체 시험",
];

const now = new Date();
const EMPTY_EXAM = {
  examName: `${now.getFullYear()}년 ${now.getMonth()+1}월`,
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  round: 1,
  totalQuestions: 45,
  maxScore: 100,
  date: now.toISOString().slice(0, 10),
  score: "",
  wrongNos: "",      // "3,7,12" 형식
  memo: "",
};

export default function AdminInputPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const storage = useMemo(() => createStorage(), []);
  const assignmentStore = useMemo(() => createAssignmentStore(), []);

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [assignmentTypes, setAssignmentTypes] = useState<AssignmentType[]>([]);
  const [selectedStudent, setSelectedStudent] = useState("");
  const [inputTab, setInputTab] = useState<"exam" | "assignment" | "types">("exam");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // 과제유형 관리 상태
  const [typeForm, setTypeForm] = useState({
    name: "", targetCount: 1,
    kind: "general" as "mock_exam" | "general",
    itemLabel: "", scopeLabel: "", completedLabel: "",
  });
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [typeNotice, setTypeNotice] = useState("");

  // 모의고사 폼
  const [examForm, setExamForm] = useState(EMPTY_EXAM);
  const [recentExams, setRecentExams] = useState<ExamResult[]>([]);

  // 과제 폼
  const [asgForm, setAsgForm] = useState({
    typeId: "",
    round: 1,
    score: "",
    wrongNos: "",
    completed: true,
    totalMinutes: "",
    memo: "",
  });
  const [recentAsgs, setRecentAsgs] = useState<AssignmentSubmission[]>([]);

  useEffect(() => {
    rosterStore.listRoster().then(r => setRoster(r.filter(s => (s.studentStatus ?? "active") !== "withdrawn")));
    assignmentStore.listTypes().then(setAssignmentTypes);
  }, []);

  useEffect(() => {
    if (!selectedStudent) return;
    // 해당 학생의 최근 데이터 로드
    storage.listResults().then(all =>
      setRecentExams(all.filter(r => r.student.studentCode === selectedStudent)
        .sort((a,b) => b.date.localeCompare(a.date)).slice(0,10))
    );
    assignmentStore.listSubmissionsForStudent(selectedStudent).then(all =>
      setRecentAsgs(all.sort((a,b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0,10))
    );
  }, [selectedStudent]);

  // ── 모의고사 저장 ────────────────────────────────
  async function saveExam() {
    const student = roster.find(r => r.studentCode === selectedStudent);
    if (!student) { setError("학생을 선택해주세요."); return; }
    const score = Number(examForm.score);
    if (!examForm.score || isNaN(score) || score < 0 || score > 100) {
      setError("점수를 올바르게 입력해주세요. (0~100)"); return;
    }

    setSaving(true); setError("");
    try {
      // 틀린 문항 파싱
      const wrongNos = examForm.wrongNos
        .split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
        .map(Number).filter(n => !isNaN(n) && n > 0);

      const result: ExamResult = {
        id: `admin_${Date.now()}_${selectedStudent}`,
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
          totalQuestions: examForm.totalQuestions,
          maxScore: examForm.maxScore,
        },
        teacher: "관리자 직접 입력",
        date: examForm.date,
        score,
        wrongAnswers: wrongNos.map(n => ({ questionNo: n, reasons: [], chosenOption: null })),
        reflection: { hardestReason: examForm.memo, nextGoal: "", satisfaction: 0 },
        submittedAt: new Date().toISOString(),
      };

      await storage.saveResult(result);
      setNotice(`✅ ${student.name} 모의고사 저장 완료 (${score}점)`);
      setExamForm(EMPTY_EXAM);
      // 목록 갱신
      storage.listResults().then(all =>
        setRecentExams(all.filter(r => r.student.studentCode === selectedStudent)
          .sort((a,b) => b.date.localeCompare(a.date)).slice(0,10))
      );
      setTimeout(() => setNotice(""), 4000);
    } catch(e) { setError("저장 실패: " + (e as Error).message); }
    setSaving(false);
  }

  // ── 과제유형 저장 ────────────────────────────────────
  async function saveType() {
    if (!typeForm.name.trim()) { setTypeNotice("유형 이름을 입력해주세요."); return; }
    setSaving(true);
    try {
      const id = editingTypeId ?? `type_${Date.now()}`;
      await assignmentStore.saveType({
        id,
        name: typeForm.name.trim(),
        targetCount: typeForm.targetCount,
        kind: typeForm.kind,
        itemLabel: typeForm.itemLabel || undefined,
        scopeLabel: typeForm.scopeLabel || undefined,
        completedLabel: typeForm.completedLabel || undefined,
      });
      setTypeNotice(editingTypeId ? "✅ 수정됐습니다." : "✅ 과제 유형이 추가됐습니다.");
      setTypeForm({ name:"", targetCount:1, kind:"general", itemLabel:"", scopeLabel:"", completedLabel:"" });
      setEditingTypeId(null);
      assignmentStore.listTypes().then(setAssignmentTypes);
      setTimeout(() => setTypeNotice(""), 3000);
    } catch(e) { setTypeNotice("저장 실패: " + (e as Error).message); }
    setSaving(false);
  }

  async function deleteType(id: string, name: string) {
    if (!confirm(`"${name}" 유형을 삭제하시겠습니까?
이미 제출된 과제 기록은 유지됩니다.`)) return;
    await assignmentStore.deleteType(id);
    setAssignmentTypes(prev => prev.filter(t => t.id !== id));
    setTypeNotice("삭제됐습니다."); setTimeout(() => setTypeNotice(""), 2000);
  }

  function startEditType(type: import("../../core/assignment").AssignmentType) {
    setEditingTypeId(type.id);
    setTypeForm({
      name: type.name,
      targetCount: type.targetCount,
      kind: type.kind ?? "general",
      itemLabel: type.itemLabel ?? "",
      scopeLabel: type.scopeLabel ?? "",
      completedLabel: type.completedLabel ?? "",
    });
    setInputTab("types");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── 과제 저장 ─────────────────────────────────────
  async function saveAssignment() {
    const student = roster.find(r => r.studentCode === selectedStudent);
    if (!student) { setError("학생을 선택해주세요."); return; }
    if (!asgForm.typeId) { setError("과제 유형을 선택해주세요."); return; }

    setSaving(true); setError("");
    try {
      const wrongNos = asgForm.wrongNos
        .split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
        .map(Number).filter(n => !isNaN(n) && n > 0);

      const entry: AssignmentSubmission = {
        id: `admin_asg_${Date.now()}_${selectedStudent}`,
        studentCode: selectedStudent,
        typeId: asgForm.typeId,
        round: asgForm.round,
        score: asgForm.score ? Number(asgForm.score) : null,
        wrongNumbers: wrongNos,
        completed: asgForm.completed,
        totalMinutes: asgForm.totalMinutes ? Number(asgForm.totalMinutes) : undefined,
        submittedAt: new Date().toISOString(),
      };

      await assignmentStore.submit(entry);
      setNotice(`✅ ${student.name} 과제 저장 완료`);
      setAsgForm({ typeId: "", round: 1, score: "", wrongNos: "", completed: true, totalMinutes: "", memo: "" });
      assignmentStore.listSubmissionsForStudent(selectedStudent).then(all =>
        setRecentAsgs(all.sort((a,b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0,10))
      );
      setTimeout(() => setNotice(""), 4000);
    } catch(e) { setError("저장 실패: " + (e as Error).message); }
    setSaving(false);
  }

  // ── 삭제 ─────────────────────────────────────────
  async function deleteExam(id: string) {
    if (!confirm("이 모의고사 기록을 삭제하시겠습니까?")) return;
    await fetch(`${SUPABASE_URL}/rest/v1/results?id=eq.${id}`, {
      method: "DELETE", headers: SB_H,
    });
    setRecentExams(prev => prev.filter(r => r.id !== id));
    setNotice("삭제됐습니다."); setTimeout(() => setNotice(""), 2000);
  }

  const student = roster.find(r => r.studentCode === selectedStudent);

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ marginBottom:20 }}>
        <h2 style={{ margin:"0 0 4px", color:"#7c3aed", display:"flex", alignItems:"center", gap:8 }}>
          <Edit2 size={20} color="#7c3aed"/> 관리자 직접 입력
        </h2>
        <p style={{ fontSize:12, color:"#64748b", margin:0 }}>
          학생 대신 모의고사 점수 및 과제 결과를 직접 입력합니다.
        </p>
      </div>

      {notice && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:14, fontWeight:600, fontSize:13,
          background:"#f0fdf4", border:"1px solid #86efac", color:"#166534" }}>
          {notice}
        </div>
      )}
      {error && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:14, fontSize:13,
          background:"#fef2f2", border:"1px solid #fca5a5", color:"#dc2626" }}>
          {error}
        </div>
      )}

      {/* 학생 선택 */}
      <div style={{ marginBottom:16, padding:"14px", background:"#f8fafc",
        borderRadius:10, border:"1px solid #e2e8f0" }}>
        <label style={{ fontSize:13, fontWeight:700, display:"block", marginBottom:8, color:"#374151" }}>
          학생 선택 ★
        </label>
        <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
          style={{ width:"100%", padding:"10px 12px", borderRadius:8,
            border:"1.5px solid #7c3aed", fontSize:15, fontWeight:600, background:"#fff" }}>
          <option value="">-- 학생을 선택하세요 --</option>
          {roster.map(r => (
            <option key={r.studentCode} value={r.studentCode}>
              {r.name} ({r.school} {r.grade}학년)
            </option>
          ))}
        </select>
        {student && (
          <p style={{ fontSize:12, color:"#7c3aed", fontWeight:600, margin:"8px 0 0" }}>
            선택됨: {student.name} · {student.school} {student.grade}학년
            {student.phone && ` · ${student.phone}`}
          </p>
        )}
      </div>

      {/* 탭 버튼 — 항상 표시 (과제유형은 학생 미선택에서도 사용) */}
      <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2, marginBottom:18, flexWrap:"wrap" }}>
        {([
          { key:"exam",       label:"모의고사", icon:<ClipboardList size={14}/> },
          { key:"assignment", label:"과제",     icon:<FileText size={14}/> },
          { key:"types",      label:"과제유형 관리", icon:<ClipboardList size={14}/> },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setInputTab(t.key)}
            style={{ padding:"7px 18px", borderRadius:6, border:"none", fontSize:13,
              fontWeight:600, cursor:"pointer",
              background: inputTab===t.key ? "#7c3aed" : "transparent",
              color: inputTab===t.key ? "#fff" : "#64748b",
              display:"flex", alignItems:"center", gap:5 }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {selectedStudent && inputTab !== "types" && (
        <>

          {/* ── 모의고사 입력 ── */}
          {inputTab === "exam" && (
            <div>
              <div style={{ border:"1.5px solid #e0e7ff", borderRadius:12,
                padding:18, marginBottom:20, background:"#f5f3ff" }}>
                <h3 style={{ fontSize:14, fontWeight:700, color:"#7c3aed", marginBottom:14 }}>
                  모의고사 점수 입력
                </h3>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      시험 종류
                    </label>
                    <select value={examForm.examName}
                      onChange={e => {
                        const name = e.target.value;
                        const m = name.match(/(\d+)월/);
                        setExamForm({...examForm, examName: name,
                          month: m ? Number(m[1]) : examForm.month });
                      }}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #c4b5fd", fontSize:13 }}>
                      {EXAM_TYPES.map(t => (
                        <option key={t} value={`${examForm.year}년 ${t}`}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      시험 날짜
                    </label>
                    <input type="date" value={examForm.date}
                      onChange={e => setExamForm({...examForm, date: e.target.value})}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #c4b5fd", fontSize:13 }} />
                  </div>
                </div>

                {/* 점수 — 크게 표시 */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:13, fontWeight:700, display:"block", marginBottom:8, color:"#374151" }}>
                    점수 (0 ~ 100)
                  </label>
                  <input
                    type="number" min={0} max={100}
                    value={examForm.score}
                    onChange={e => setExamForm({...examForm, score: e.target.value})}
                    placeholder="예) 78"
                    style={{ width:"100%", padding:"14px 16px", borderRadius:10,
                      border:"2px solid #7c3aed", fontSize:28, fontWeight:700,
                      textAlign:"center", color:"#7c3aed", background:"#fff",
                      boxSizing:"border-box" as const }} />
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      연도
                    </label>
                    <input type="number" value={examForm.year}
                      onChange={e => setExamForm({...examForm, year: Number(e.target.value)})}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #c4b5fd", fontSize:13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      회차
                    </label>
                    <input type="number" min={1} value={examForm.round}
                      onChange={e => setExamForm({...examForm, round: Number(e.target.value)})}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #c4b5fd", fontSize:13 }} />
                  </div>
                </div>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                    틀린 문항 번호 (쉼표 또는 공백으로 구분)
                  </label>
                  <input value={examForm.wrongNos}
                    onChange={e => setExamForm({...examForm, wrongNos: e.target.value})}
                    placeholder="예) 3, 7, 12, 18, 25"
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                      border:"1px solid #c4b5fd", fontSize:13, boxSizing:"border-box" as const }} />
                </div>

                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                    메모 (선택)
                  </label>
                  <textarea value={examForm.memo}
                    onChange={e => setExamForm({...examForm, memo: e.target.value})}
                    placeholder="특이사항, 학생 상태 등"
                    rows={2}
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                      border:"1px solid #c4b5fd", fontSize:13, resize:"none" as const,
                      boxSizing:"border-box" as const }} />
                </div>

                <button onClick={saveExam} disabled={saving}
                  style={{ width:"100%", padding:"13px", borderRadius:10, border:"none",
                    background: saving ? "#e2e8f0" : "#7c3aed",
                    color: saving ? "#94a3b8" : "#fff",
                    fontWeight:700, fontSize:15, cursor: saving ? "not-allowed" : "pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <Save size={16}/> {saving ? "저장 중…" : "모의고사 저장"}
                </button>
              </div>

              {/* 최근 모의고사 목록 */}
              {recentExams.length > 0 && (
                <div>
                  <h3 style={{ fontSize:13, fontWeight:700, color:"#475569", marginBottom:10 }}>
                    최근 제출 이력 ({recentExams.length}건)
                  </h3>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {recentExams.map(ex => (
                      <div key={ex.id} style={{ display:"flex", alignItems:"center",
                        justifyContent:"space-between", padding:"10px 14px",
                        border:"1px solid #e2e8f0", borderRadius:8, background:"#fff",
                        flexWrap:"wrap", gap:8 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                          <span style={{ fontSize:13, fontWeight:700,
                            color: ex.score >= 90 ? "#059669" : ex.score >= 70 ? "#2563eb" : "#ef4444" }}>
                            {ex.score}점
                          </span>
                          <span style={{ fontSize:12, color:"#64748b" }}>{ex.exam.examName}</span>
                          <span style={{ fontSize:11, color:"#94a3b8" }}>{ex.date}</span>
                          {ex.teacher === "관리자 직접 입력" && (
                            <span style={{ fontSize:10, padding:"1px 6px", borderRadius:4,
                              background:"#ede9fe", color:"#7c3aed", fontWeight:600 }}>관리자 입력</span>
                          )}
                        </div>
                        <button onClick={() => deleteExam(ex.id)}
                          style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #fca5a5",
                            background:"#fff", color:"#ef4444", fontSize:11, cursor:"pointer",
                            display:"flex", alignItems:"center", gap:3 }}>
                          <Trash2 size={11}/> 삭제
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 과제 입력 ── */}
          {inputTab === "assignment" && (
            <div>
              <div style={{ border:"1.5px solid #d1fae5", borderRadius:12,
                padding:18, marginBottom:20, background:"#f0fdf4" }}>
                <h3 style={{ fontSize:14, fontWeight:700, color:"#059669", marginBottom:14 }}>
                  과제 결과 입력
                </h3>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                    과제 유형 ★
                  </label>
                  <select value={asgForm.typeId}
                    onChange={e => setAsgForm({...asgForm, typeId: e.target.value})}
                    style={{ width:"100%", padding:"10px 12px", borderRadius:8,
                      border:"1.5px solid #6ee7b7", fontSize:14, fontWeight:600, background:"#fff" }}>
                    <option value="">-- 과제 유형 선택 --</option>
                    {assignmentTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      회차
                    </label>
                    <input type="number" min={1} value={asgForm.round}
                      onChange={e => setAsgForm({...asgForm, round: Number(e.target.value)})}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #6ee7b7", fontSize:13 }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      점수 (선택)
                    </label>
                    <input type="number" value={asgForm.score}
                      onChange={e => setAsgForm({...asgForm, score: e.target.value})}
                      placeholder="예) 85"
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #6ee7b7", fontSize:13 }} />
                  </div>
                </div>

                <div style={{ marginBottom:10 }}>
                  <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                    틀린 문항 번호 (쉼표 구분)
                  </label>
                  <input value={asgForm.wrongNos}
                    onChange={e => setAsgForm({...asgForm, wrongNos: e.target.value})}
                    placeholder="예) 3, 7, 15"
                    style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                      border:"1px solid #6ee7b7", fontSize:13, boxSizing:"border-box" as const }} />
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      소요 시간 (분)
                    </label>
                    <input type="number" value={asgForm.totalMinutes}
                      onChange={e => setAsgForm({...asgForm, totalMinutes: e.target.value})}
                      placeholder="예) 40"
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #6ee7b7", fontSize:13 }} />
                  </div>
                  <div style={{ display:"flex", alignItems:"center", paddingTop:24 }}>
                    <label style={{ display:"flex", alignItems:"center", gap:8,
                      fontSize:13, fontWeight:600, cursor:"pointer" }}>
                      <input type="checkbox" checked={asgForm.completed}
                        onChange={e => setAsgForm({...asgForm, completed: e.target.checked})}
                        style={{ width:18, height:18 }} />
                      완료됨
                    </label>
                  </div>
                </div>

                <button onClick={saveAssignment} disabled={saving}
                  style={{ width:"100%", padding:"13px", borderRadius:10, border:"none",
                    background: saving ? "#e2e8f0" : "#059669",
                    color: saving ? "#94a3b8" : "#fff",
                    fontWeight:700, fontSize:15, cursor: saving ? "not-allowed" : "pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
                  <Save size={16}/> {saving ? "저장 중…" : "과제 저장"}
                </button>
              </div>

              {/* 최근 과제 목록 */}
              {recentAsgs.length > 0 && (
                <div>
                  <h3 style={{ fontSize:13, fontWeight:700, color:"#475569", marginBottom:10 }}>
                    최근 과제 이력 ({recentAsgs.length}건)
                  </h3>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {recentAsgs.map((asg, i) => {
                      const type = assignmentTypes.find(t => t.id === asg.typeId);
                      return (
                        <div key={i} style={{ padding:"10px 14px",
                          border:"1px solid #e2e8f0", borderRadius:8, background:"#fff",
                          display:"flex", alignItems:"center", justifyContent:"space-between",
                          flexWrap:"wrap", gap:8 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                            <span style={{ fontSize:13, fontWeight:700, color:"#374151" }}>
                              {type?.name ?? asg.typeId}
                            </span>
                            <span style={{ fontSize:11, color:"#64748b" }}>
                              {asg.round}회차
                            </span>
                            {asg.score != null && (
                              <span style={{ fontSize:12, fontWeight:700,
                                color: asg.score >= 90 ? "#059669" : asg.score >= 70 ? "#2563eb" : "#ef4444" }}>
                                {asg.score}점
                              </span>
                            )}
                            <span style={{ fontSize:11, color:"#94a3b8" }}>
                              {asg.submittedAt.slice(0,10)}
                            </span>
                            {asg.completed && (
                              <CheckCircle size={12} color="#059669"/>
                            )}
                          </div>
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

      {/* ── 과제유형 관리 — 학생 미선택에서도 접근 가능 ── */}
      {inputTab === "types" && (
            <div>
              {typeNotice && (
                <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:12,
                  fontWeight:600, fontSize:13,
                  background: typeNotice.startsWith("✅") ? "#f0fdf4" : "#fef2f2",
                  border: `1px solid ${typeNotice.startsWith("✅") ? "#86efac" : "#fca5a5"}`,
                  color: typeNotice.startsWith("✅") ? "#166534" : "#dc2626" }}>
                  {typeNotice}
                </div>
              )}

              {/* 추가/수정 폼 */}
              <div style={{ border:"1.5px solid #e0e7ff", borderRadius:12,
                padding:18, marginBottom:20, background:"#f5f3ff" }}>
                <h3 style={{ fontSize:14, fontWeight:700, color:"#7c3aed", marginBottom:14 }}>
                  {editingTypeId ? "과제 유형 수정" : "새 과제 유형 추가"}
                </h3>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                  <div style={{ gridColumn:"1/-1" }}>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      유형 이름 ★
                    </label>
                    <input value={typeForm.name}
                      onChange={e => setTypeForm({...typeForm, name: e.target.value})}
                      placeholder="예) 수능 모의고사, 워크북, 단어시험, EBS 변형"
                      style={{ width:"100%", padding:"10px 12px", borderRadius:8,
                        border:"1.5px solid #7c3aed", fontSize:14, fontWeight:600,
                        boxSizing:"border-box" as const }} />
                  </div>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      종류
                    </label>
                    <select value={typeForm.kind}
                      onChange={e => setTypeForm({...typeForm, kind: e.target.value as "mock_exam"|"general"})}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #c4b5fd", fontSize:13 }}>
                      <option value="general">일반 과제</option>
                      <option value="mock_exam">모의고사 형식</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
                      목표 횟수
                    </label>
                    <input type="number" min={1} max={20} value={typeForm.targetCount}
                      onChange={e => setTypeForm({...typeForm, targetCount: Number(e.target.value)})}
                      style={{ width:"100%", padding:"8px 10px", borderRadius:8,
                        border:"1px solid #c4b5fd", fontSize:13 }} />
                  </div>
                </div>

                {/* 고급 설정 */}
                <details style={{ marginBottom:12 }}>
                  <summary style={{ fontSize:12, color:"#7c3aed", cursor:"pointer",
                    fontWeight:600, marginBottom:8 }}>
                    고급 설정 (화면 표시 이름 커스텀)
                  </summary>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:8 }}>
                    {[
                      { key:"itemLabel", label:"항목 이름", placeholder:"예) 문항" },
                      { key:"scopeLabel", label:"범위 이름", placeholder:"예) 단원" },
                      { key:"completedLabel", label:"완료 이름", placeholder:"예) 제출완료" },
                    ].map(f => (
                      <div key={f.key}>
                        <label style={{ fontSize:11, fontWeight:600, display:"block", marginBottom:4 }}>
                          {f.label}
                        </label>
                        <input value={(typeForm as any)[f.key]}
                          onChange={e => setTypeForm({...typeForm, [f.key]: e.target.value})}
                          placeholder={f.placeholder}
                          style={{ width:"100%", padding:"6px 8px", borderRadius:6,
                            border:"1px solid #c4b5fd", fontSize:12,
                            boxSizing:"border-box" as const }} />
                      </div>
                    ))}
                  </div>
                </details>

                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={saveType} disabled={saving}
                    style={{ flex:1, padding:"11px", borderRadius:8, border:"none",
                      background: saving ? "#e2e8f0" : "#7c3aed",
                      color: saving ? "#94a3b8" : "#fff",
                      fontWeight:700, fontSize:14, cursor: saving ? "not-allowed" : "pointer",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                    <Save size={14}/>
                    {editingTypeId ? "수정 저장" : "유형 추가"}
                  </button>
                  {editingTypeId && (
                    <button onClick={() => {
                      setEditingTypeId(null);
                      setTypeForm({ name:"", targetCount:1, kind:"general",
                        itemLabel:"", scopeLabel:"", completedLabel:"" });
                    }}
                      style={{ padding:"11px 18px", borderRadius:8, border:"1px solid #e2e8f0",
                        background:"#fff", fontSize:14, cursor:"pointer" }}>
                      취소
                    </button>
                  )}
                </div>
              </div>

              {/* 현재 유형 목록 */}
              <h3 style={{ fontSize:13, fontWeight:700, color:"#475569", marginBottom:10 }}>
                등록된 과제 유형 ({assignmentTypes.length}개)
              </h3>
              {assignmentTypes.length === 0 ? (
                <p style={{ color:"#94a3b8", textAlign:"center", padding:"20px 0" }}>
                  등록된 과제 유형이 없습니다. 위에서 추가해주세요.
                </p>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {assignmentTypes.map(type => (
                    <div key={type.id}
                      style={{ border:"1px solid #e2e8f0", borderRadius:10, padding:"12px 14px",
                        background:"#fff", display:"flex", alignItems:"center",
                        justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                        <span style={{ fontWeight:700, fontSize:14, color:"#1e293b" }}>
                          {type.name}
                        </span>
                        <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6, fontWeight:600,
                          background: type.kind==="mock_exam" ? "#dbeafe" : "#f1f5f9",
                          color: type.kind==="mock_exam" ? "#1e40af" : "#475569" }}>
                          {type.kind==="mock_exam" ? "모의고사" : "일반"}
                        </span>
                        <span style={{ fontSize:11, color:"#94a3b8" }}>
                          목표 {type.targetCount}회
                        </span>
                      </div>
                      <div style={{ display:"flex", gap:6 }}>
                        <button onClick={() => startEditType(type)}
                          style={{ display:"flex", alignItems:"center", gap:4,
                            padding:"5px 12px", borderRadius:6,
                            border:"1px solid #c4b5fd", background:"#fff",
                            color:"#7c3aed", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                          <Edit2 size={11}/> 수정
                        </button>
                        <button onClick={() => deleteType(type.id, type.name)}
                          style={{ display:"flex", alignItems:"center", gap:4,
                            padding:"5px 12px", borderRadius:6,
                            border:"1px solid #fca5a5", background:"#fff",
                            color:"#ef4444", fontSize:12, cursor:"pointer" }}>
                          <Trash2 size={11}/> 삭제
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
      {!selectedStudent && inputTab !== "types" && (
        <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
          <Edit2 size={40} color="#cbd5e1" style={{ marginBottom:10 }}/>
          <p style={{ fontSize:14 }}>위에서 학생을 선택하면 입력 화면이 나타납니다.</p>
        </div>
      )}
    </div>
  );
}

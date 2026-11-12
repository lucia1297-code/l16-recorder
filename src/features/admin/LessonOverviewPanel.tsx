import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, ClipboardCheck, FileText, NotebookPen, Pencil, Plus, Save, Users, X } from "lucide-react";
import type { RosterEntry } from "../../core/roster";
import type { TeacherLog } from "../../core/teacherLog";
import { makeLogId } from "../../core/teacherLog";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import { createTeacherLogStore } from "../../lib/teacherLogStoreFactory";

type ExamSchedule = {
  id: string; studentCode: string; name: string; school: string; grade: string;
  semester: string; examType: string; subject: string; examStart: string; examEnd: string;
  englishExamDate: string; reportDeadline: string; nextLessonDate: string;
  examRange: string; completed: boolean; memo: string; source: "supabase" | "local";
};
type PrepPlan = { id: string; exam_id: string; student_code: string; english_exam_date: string; week_number: number; task_label: string; task_detail: string; status: "pending" | "done" | "skipped" | "adjusted"; adjusted_note?: string };
type FollowUp = { id: string; due: string; text: string; done: boolean };
type LinkedMemo = { id: string; title: string; body: string; tag: string; alarm: string; createdAt: string; updatedAt: string; studentCode?: string; lessonDate?: string };

const ink = "#172b4d", blue = "#3867c8", pale = "#f3f6fb", line = "#e4eaf2";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const TASKS_MARKER = "[L16 후속 처리]";
const styles = `
  .l16-lesson-root{height:100%;min-height:0;overflow:auto;color:${ink};font-family:inherit}
  .l16-lesson-grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:16px;align-items:start}
  .l16-lesson-card{background:#fff;border:1px solid ${line};border-radius:14px;overflow:hidden;box-shadow:0 3px 12px rgba(28,50,85,.045)}
  .l16-lesson-card.record{background:#eaf1fd;border-color:#cddcf5}
  .l16-lesson-card.record .l16-lesson-head{background:#dce8fa;border-bottom-color:#cddcf5}
  .l16-lesson-card.exam{background:#fdf3e3;border-color:#f1dcb8}
  .l16-lesson-card.exam .l16-lesson-head{background:#f9e6c6;border-bottom-color:#f1dcb8}
  .l16-lesson-card.exam .l16-lesson-period{border-color:#f1dcb8;background:#fffaf1}
  .l16-lesson-card.exam .l16-lesson-stat{background:#fffaf1}
  .l16-lesson-card.record .l16-lesson-stat{background:#f6f9ff;border-color:#cddcf5}
  .l16-lesson-card.record .l16-lesson-row{border-color:#cddcf5}
  .l16-lesson-linked{margin-top:14px;padding:12px;background:#e3f3ea;border:1px solid #c5e3d1;border-radius:10px}
  .l16-lesson-note{margin-top:10px;padding:11px;background:#fbe9d2;border-radius:10px;font-size:10px;color:#7a5a2d;line-height:1.55}
  .app.l16-app-wide{max-width:none}
  .l16-lesson-head{padding:15px 17px;border-bottom:1px solid ${line};display:flex;align-items:center;justify-content:space-between;gap:10px}
  .l16-lesson-body{padding:16px}
  .l16-lesson-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .l16-lesson-root button,.l16-lesson-root input,.l16-lesson-root select,.l16-lesson-root textarea{font:inherit}
  .l16-lesson-root button{cursor:pointer}
  .l16-lesson-input{width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid #d8e0eb;border-radius:9px;color:${ink};background:#fff}
  .l16-lesson-root textarea{resize:vertical;min-height:92px;line-height:1.55}
  .l16-lesson-label{display:block;font-size:12px;font-weight:700;margin:13px 0 6px;color:#52647d}
  .l16-lesson-primary{border:0;border-radius:9px;padding:9px 13px;background:${blue};color:#fff;font-weight:700;display:inline-flex;gap:7px;align-items:center;justify-content:center;min-height:38px}
  .l16-lesson-ghost{border:1px solid #d8e0eb;border-radius:9px;padding:8px 11px;background:#fff;color:#344a68;display:inline-flex;gap:6px;align-items:center;justify-content:center;min-height:36px}
  .l16-lesson-chip{border-radius:999px;background:#edf3ff;color:#315ba7;padding:5px 9px;font-size:11px;font-weight:700;white-space:nowrap}
  .l16-lesson-weeknav{display:flex;align-items:center;gap:5px}
  .l16-lesson-list{display:grid;gap:8px;margin-top:12px}
  .l16-lesson-row{display:flex;gap:9px;align-items:center;border:1px solid ${line};border-radius:10px;padding:10px;background:#fff;text-align:left;width:100%;color:inherit}
  .l16-lesson-row.selected{border-color:#93b1eb;background:#f4f7ff}
  .l16-lesson-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px}
  .l16-lesson-stat{padding:11px;border:1px solid ${line};border-radius:10px;background:#fbfcfe}
  .l16-lesson-task{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-bottom:1px solid #eef1f5}
  .l16-lesson-badge{border-radius:999px;padding:4px 8px;font-size:10px;font-weight:700;background:#eaf6f0;color:#178258}
  .l16-lesson-period{padding:12px;border:1px solid ${line};border-radius:11px;display:grid;gap:8px;background:#fff}
  .l16-lesson-modal{position:fixed;inset:0;background:rgba(18,31,54,.55);z-index:9999;display:grid;place-items:center;padding:18px}
  .l16-lesson-modalbox{background:white;border-radius:16px;width:min(1050px,100%);max-height:90vh;overflow:auto;box-shadow:0 24px 80px rgba(10,25,50,.28)}
  .l16-lesson-tablewrap{overflow:auto;border:1px solid ${line};border-radius:10px}
  .l16-lesson-table{border-collapse:collapse;width:100%;min-width:760px;font-size:12px}
  .l16-lesson-table th,.l16-lesson-table td{padding:10px 9px;border-bottom:1px solid #edf0f5;text-align:left;white-space:nowrap}
  .l16-lesson-table th{background:#f6f8fb;color:#66758b;font-size:10px;position:sticky;top:0}
  .l16-lesson-notice{margin:0 0 12px;padding:10px 12px;border-radius:9px;background:#eff6ff;color:#315ba7;font-size:12px}
  @media(max-width:1050px){.l16-lesson-grid{grid-template-columns:minmax(0,2fr) minmax(250px,1fr);gap:10px}.l16-lesson-body{padding:12px}}
  @media(max-width:760px){.l16-lesson-root{overflow:visible}.l16-lesson-grid{grid-template-columns:1fr}.l16-lesson-head{padding:13px}.l16-lesson-body{padding:13px}.l16-lesson-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.l16-lesson-root button{min-height:40px}.l16-lesson-modal{padding:8px;align-items:end}.l16-lesson-modalbox{max-height:94vh;border-radius:16px 16px 8px 8px}.l16-lesson-modal .l16-lesson-head{position:sticky;top:0;background:white;z-index:2}.l16-lesson-mobile-full{width:100%}}
  @media(max-width:420px){.l16-lesson-stats{grid-template-columns:1fr}.l16-lesson-controls>*{flex:1}.l16-lesson-weeknav{flex:0 0 100%;justify-content:space-between}.l16-lesson-weeknav input{flex:1}.l16-lesson-body{padding:11px}.l16-lesson-root textarea{min-height:82px}}
`;

function dateKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function mondayOf(date: string) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dateKey(d); }
function shiftDate(date: string, days: number) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + days); return dateKey(d); }
function weekLabel(monday: string) { const sunday = shiftDate(monday, 6); return `${monday.slice(5).replace("-","/")} ~ ${sunday.slice(5).replace("-","/")}`; }
function activeStudent(s: RosterEntry) { return (s.studentStatus ?? "active") !== "withdrawn"; }
function decodeLogNotes(raw: string): { memo: string; tasks: FollowUp[] } {
  const index = raw.indexOf(TASKS_MARKER);
  if (index < 0) return { memo: raw, tasks: [] };
  const memo = raw.slice(0, index).trim();
  const tasks = raw.slice(index + TASKS_MARKER.length).split("\n").map(line => {
    const match = line.match(/^\s*- \[([ xX])\] \[([^\]]*)\] (.*)$/);
    if (!match) return null;
    const [, checked, due, text] = match;
    return { id: `${due}-${text}`, due: due === "기한 없음" ? "" : due, text, done: checked.toLowerCase() === "x" };
  }).filter((x): x is FollowUp => !!x);
  return { memo, tasks };
}
function encodeLogNotes(memo: string, tasks: FollowUp[]) {
  const taskBlock = tasks.length ? `${TASKS_MARKER}\n${tasks.map(t => `- [${t.done ? "x" : " "}] [${t.due || "기한 없음"}] ${t.text}`).join("\n")}` : "";
  return [memo.trim(), taskBlock].filter(Boolean).join("\n\n");
}
function mapSchedule(r: any, roster: RosterEntry[], source: ExamSchedule["source"]): ExamSchedule {
  const code = r.student_code ?? r.studentCode ?? "";
  const student = roster.find(s => s.studentCode === code);
  return {
    id: String(r.id ?? `${code}-${r.english_exam_date ?? r.englishExamDate ?? ""}`), studentCode: code,
    name: r.student_name ?? student?.name ?? code, school: r.school ?? student?.school ?? "", grade: r.grade ?? student?.grade ?? "",
    semester: String(r.semester ?? "2"), examType: r.exam_type ?? r.examType ?? "final", subject: r.subject ?? "영어",
    examStart: r.exam_start ?? r.examStart ?? "", examEnd: r.exam_end ?? r.examEnd ?? "",
    englishExamDate: r.english_exam_date ?? r.englishExamDate ?? "", reportDeadline: r.report_deadline ?? r.reportDeadline ?? "",
    nextLessonDate: r.next_lesson_date ?? r.nextLessonDate ?? "", examRange: r.exam_range ?? r.examRange ?? "",
    completed: r.completed ?? false, memo: r.memo ?? "", source,
  };
}
function periodKey(e: ExamSchedule) { return [e.school,e.grade,e.semester,e.examType,e.subject,(e.englishExamDate || e.examStart).slice(0,4)].join("|"); }
// 이미 지난 시험: 영어 시험일(없으면 시험 종료일·시작일)이 오늘 이전이면 제외
function isPastExam(e: ExamSchedule, today: string) {
  const ref = e.englishExamDate || e.examEnd || e.examStart;
  return !!ref && ref < today;
}
function periodName(e: ExamSchedule) { return `${e.school || "학교 미지정"} ${e.grade ? `${e.grade}학년` : ""} · ${e.semester}학기 ${e.examType === "midterm" ? "중간고사" : "기말고사"} · ${e.subject}`; }

export default function LessonOverviewPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const logStore = useMemo(() => createTeacherLogStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [logs, setLogs] = useState<TeacherLog[]>([]);
  const [exams, setExams] = useState<ExamSchedule[]>([]);
  const [plans, setPlans] = useState<PrepPlan[]>([]);
  const [monday, setMonday] = useState(() => mondayOf(dateKey(new Date())));
  const [studentCode, setStudentCode] = useState("");
  const [lessonDate, setLessonDate] = useState(dateKey(new Date()));
  const [classContent, setClassContent] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [teacherMemo, setTeacherMemo] = useState("");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [newTask, setNewTask] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [period, setPeriod] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [editExam, setEditExam] = useState<ExamSchedule | null>(null);
  const [examDraft, setExamDraft] = useState<ExamSchedule | null>(null);
  const [memos, setMemos] = useState<LinkedMemo[]>(() => {
    try { return JSON.parse(localStorage.getItem("l16_memos") || "[]"); } catch { return []; }
  });

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      const [rosterResult, logsResult] = await Promise.allSettled([rosterStore.listRoster(), logStore.listAllLogs()]);
      const students = rosterResult.status === "fulfilled" ? rosterResult.value.filter(activeStudent) : [];
      if (!alive) return;
      setRoster(students);
      if (!studentCode && students[0]) setStudentCode(students[0].studentCode);
      if (logsResult.status === "fulfilled") setLogs(logsResult.value);
      else setNotice(`수업 기록을 불러오지 못했습니다: ${String(logsResult.reason?.message ?? logsResult.reason)}`);

      let remoteExams: ExamSchedule[] = [];
      let remotePlans: PrepPlan[] = [];
      if (SUPABASE_URL && SUPABASE_KEY) {
        try {
          const db = createClient(SUPABASE_URL, SUPABASE_KEY);
          const [{ data: scheduleRows, error: scheduleError }, { data: planRows }] = await Promise.all([
            db.from("admin_exam_schedules").select("*").order("exam_start", { ascending: true }),
            db.from("exam_prep_plans").select("*").order("english_exam_date", { ascending: true }),
          ]);
          if (scheduleError) throw scheduleError;
          remoteExams = (scheduleRows ?? []).map(row => mapSchedule(row, students, "supabase"));
          remotePlans = (planRows ?? []) as PrepPlan[];
        } catch (error) {
          if (alive) setNotice(`시험 일정을 불러오지 못했습니다: ${String((error as Error).message ?? error)}`);
        }
      }
      if (!remoteExams.length) {
        try { remoteExams = (JSON.parse(localStorage.getItem("l16.examSchedules") || "[]") as any[]).map(row => mapSchedule(row, students, "local")); } catch { remoteExams = []; }
      }
      if (alive) {
        setExams(remoteExams);
        setPlans(remotePlans);
        const todayStr = dateKey(new Date());
        const upcoming = remoteExams.filter(e => e.englishExamDate && !isPastExam(e, todayStr)).sort((a,b) => a.englishExamDate.localeCompare(b.englishExamDate))[0];
        if (upcoming) setPeriod(periodKey(upcoming));
        setLoading(false);
      }
    }
    void load();
    return () => { alive = false; };
  }, [rosterStore, logStore]);

  useEffect(() => {
    const shell = document.querySelector(".app");
    shell?.classList.add("l16-app-wide");
    return () => { shell?.classList.remove("l16-app-wide"); };
  }, []);

  const selectedStudent = roster.find(s => s.studentCode === studentCode);
  const weekLogs = useMemo(() => logs.filter(l => l.studentCode === studentCode && l.date >= monday && l.date <= shiftDate(monday,6)).sort((a,b) => b.date.localeCompare(a.date)), [logs, studentCode, monday]);
  const weekPendingCount = weekLogs.flatMap(l => decodeLogNotes(l.notes ?? "").tasks).filter(t => !t.done).length;
  const currentLog = logs.find(l => l.studentCode === studentCode && l.date === lessonDate);
  const periodGroups = useMemo(() => {
    const groups = new Map<string, ExamSchedule[]>();
    const todayStr = dateKey(new Date());
    exams.filter(e => (e.englishExamDate || e.examStart) && !isPastExam(e, todayStr)).forEach(e => { const key = periodKey(e); groups.set(key, [...(groups.get(key) ?? []), e]); });
    return [...groups.entries()].map(([key, rows]) => ({ key, rows: rows.sort((a,b) => a.englishExamDate.localeCompare(b.englishExamDate)), exemplar: rows[0] }));
  }, [exams]);
  const activePeriod = periodGroups.find(g => g.key === period) ?? periodGroups[0];
  const activeExams = activePeriod?.rows ?? [];

  useEffect(() => {
    const log = logs.find(l => l.studentCode === studentCode && l.date === lessonDate);
    const decoded = decodeLogNotes(log?.notes ?? "");
    setClassContent(log?.classContent ?? ""); setNextPlan(log?.nextPlan ?? ""); setTeacherMemo(decoded.memo); setFollowUps(decoded.tasks);
  }, [logs, lessonDate, studentCode]);

  function chooseWeek(value: string) { const next = mondayOf(value); setMonday(next); setLessonDate(value >= next && value <= shiftDate(next,6) ? value : next); }
  function startNewLesson() { setLessonDate(dateKey(new Date())); setClassContent(""); setNextPlan(""); setTeacherMemo(""); setFollowUps([]); }
  function addTask() { if (!newTask.trim()) return; setFollowUps(prev => [...prev, { id: crypto.randomUUID(), due: newTaskDue, text: newTask.trim(), done: false }]); setNewTask(""); setNewTaskDue(""); }
  function updateTask(id: string, patch: Partial<FollowUp>) { setFollowUps(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)); }
  async function saveLesson() {
    if (!studentCode) { setNotice("학생을 선택해 주세요."); return; }
    setSaving(true); setNotice("");
    const log: TeacherLog = { id: makeLogId(studentCode, lessonDate), studentCode, date: lessonDate, rows: currentLog?.rows ?? [], examRecords: currentLog?.examRecords ?? [], classContent, nextPlan, notes: encodeLogNotes(teacherMemo, followUps) };
    try {
      await logStore.saveLog(log);
      setLogs(prev => [log, ...prev.filter(item => item.id !== log.id)].sort((a,b) => b.date.localeCompare(a.date)));
      setNotice("수업 기록을 저장했습니다.");
    } catch (error) { setNotice(`저장하지 못했습니다: ${String((error as Error).message ?? error)}`); }
    finally { setSaving(false); }
  }
  function createLinkedMemo() {
    if (!selectedStudent || (!classContent.trim() && !teacherMemo.trim())) { setNotice("수업 내용이나 메모를 먼저 입력해 주세요."); return; }
    const now = new Date().toISOString();
    const memo: LinkedMemo = { id: `lesson-${studentCode}-${lessonDate}`, title: `${selectedStudent.name} · ${lessonDate} 수업`, body: [classContent.trim() && `오늘 수업\n${classContent.trim()}`, nextPlan.trim() && `다음 수업\n${nextPlan.trim()}`, teacherMemo.trim() && `메모\n${teacherMemo.trim()}`].filter(Boolean).join("\n\n"), tag: "수업", alarm: "", createdAt: now, updatedAt: now, studentCode, lessonDate };
    const next = [memo, ...memos.filter(m => m.id !== memo.id)];
    setMemos(next); localStorage.setItem("l16_memos", JSON.stringify(next)); setNotice("기존 L16 메모장에 학생·수업일이 연결된 메모를 저장했습니다.");
  }
  async function saveExamSchedule() {
    if (!examDraft) return;
    setNotice("");
    try {
      if (examDraft.source === "supabase") {
        if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase 연결 설정이 없습니다.");
        const db = createClient(SUPABASE_URL, SUPABASE_KEY);
        const { error } = await db.from("admin_exam_schedules").update({
          exam_start: examDraft.examStart || null, exam_end: examDraft.examEnd || null,
          english_exam_date: examDraft.englishExamDate || null, report_deadline: examDraft.reportDeadline || null,
          next_lesson_date: examDraft.nextLessonDate || null, exam_range: examDraft.examRange, memo: examDraft.memo,
        }).eq("id", examDraft.id);
        if (error) throw error;
      } else {
        const raw = JSON.parse(localStorage.getItem("l16.examSchedules") || "[]") as any[];
        const next = raw.map(item => item.id === examDraft.id ? { ...item, examStart: examDraft.examStart, examEnd: examDraft.examEnd, englishExamDate: examDraft.englishExamDate, reportDeadline: examDraft.reportDeadline, nextLessonDate: examDraft.nextLessonDate, examRange: examDraft.examRange, memo: examDraft.memo } : item);
        localStorage.setItem("l16.examSchedules", JSON.stringify(next));
      }
      setExams(prev => prev.map(e => e.id === examDraft.id ? examDraft : e)); setEditExam(null); setExamDraft(null); setNotice("시험 준비 일정 변경을 저장했습니다.");
    } catch (error) { setNotice(`일정을 저장하지 못했습니다: ${String((error as Error).message ?? error)}`); }
  }
  async function updatePlan(plan: PrepPlan, status: PrepPlan["status"]) {
    try {
      if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("저장된 시험 준비 계획은 온라인 연결에서만 변경할 수 있습니다.");
      const db = createClient(SUPABASE_URL, SUPABASE_KEY);
      const { error } = await db.from("exam_prep_plans").update({ status, updated_at: new Date().toISOString() }).eq("id", plan.id);
      if (error) throw error;
      setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, status } : p));
    } catch (error) { setNotice(`준비 단계 변경 실패: ${String((error as Error).message ?? error)}`); }
  }

  const compareRows = activeExams.map(exam => {
    const related = plans.filter(p => p.exam_id === exam.id || (p.student_code === exam.studentCode && p.english_exam_date === exam.englishExamDate));
    const start = exam.examStart || shiftDate(exam.englishExamDate || dateKey(new Date()), -28);
    const lessonCount = logs.filter(l => l.studentCode === exam.studentCode && l.date >= start && l.date <= (exam.englishExamDate || exam.examEnd || "9999-12-31")).length;
    const relevantLogs = logs.filter(l => l.studentCode === exam.studentCode && l.date >= start && l.date <= (exam.englishExamDate || exam.examEnd || "9999-12-31"));
    const pendingCount = relevantLogs.flatMap(l => decodeLogNotes(l.notes ?? "").tasks).filter(t => !t.done).length;
    const done = related.filter(p => p.status === "done").length;
    const percent = related.length ? Math.round(done / related.length * 100) : null;
    return { exam, related, lessonCount, pendingCount, done, percent };
  });

  return <div className="l16-lesson-root">
    <style>{styles}</style>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"end",gap:12,flexWrap:"wrap",marginBottom:14}}>
      <div><h2 style={{margin:"0 0 4px",fontSize:21}}>학생별 수업 기록</h2><div style={{fontSize:12,color:"#72819a"}}>매주 수업 내용, 다음 수업, 후속 처리와 시험 준비 일정을 한 화면에서 관리합니다.</div></div>
      <div className="l16-lesson-controls">
        <select className="l16-lesson-input" style={{width:"auto",minWidth:170}} value={studentCode} onChange={e=>setStudentCode(e.target.value)}><option value="">학생 선택</option>{roster.map(s=><option key={s.studentCode} value={s.studentCode}>{s.name} · {s.school} {s.grade}</option>)}</select>
        <button className="l16-lesson-primary" onClick={startNewLesson}><Plus size={15}/>수업 기록 추가</button>
      </div>
    </div>
    {notice && <p className="l16-lesson-notice">{notice}</p>}
    <div className="l16-lesson-grid">
      <section className="l16-lesson-card record">
        <div className="l16-lesson-head"><div><strong style={{fontSize:15}}>이번 주 수업 기록</strong><div style={{fontSize:11,color:"#7b899e",marginTop:4}}>{weekLabel(monday)} · {weekLogs.length}회 기록</div></div>
          <div className="l16-lesson-weeknav"><button className="l16-lesson-ghost" aria-label="이전 주" onClick={()=>chooseWeek(shiftDate(monday,-7))}><ChevronLeft size={16}/></button><input aria-label="수업 주간 선택" type="date" className="l16-lesson-input" style={{width:150}} value={monday} onChange={e=>chooseWeek(e.target.value)}/><button className="l16-lesson-ghost" aria-label="다음 주" onClick={()=>chooseWeek(shiftDate(monday,7))}><ChevronRight size={16}/></button></div>
        </div>
        <div className="l16-lesson-body">
          <div className="l16-lesson-stats">
            <div className="l16-lesson-stat"><div style={{fontSize:18,fontWeight:800}}>{weekLogs.length}<span style={{fontSize:11,fontWeight:500,color:"#7b899e"}}> 회</span></div><div style={{fontSize:10,color:"#7b899e"}}>이번 주 수업 기록</div></div>
            <div className="l16-lesson-stat"><div style={{fontSize:18,fontWeight:800}}>{weekPendingCount}<span style={{fontSize:11,fontWeight:500,color:"#7b899e"}}> 건</span></div><div style={{fontSize:10,color:"#7b899e"}}>이번 주 미완료 처리</div></div>
            <div className="l16-lesson-stat"><div style={{fontSize:18,fontWeight:800}}>{selectedStudent?.weeklySession ?? "–"}<span style={{fontSize:11,fontWeight:500,color:"#7b899e"}}> 회/주</span></div><div style={{fontSize:10,color:"#7b899e"}}>명부 기준 수업 횟수</div></div>
          </div>
          {weekLogs.length>0 && <div className="l16-lesson-list">{weekLogs.map(log=><button key={log.id} className={`l16-lesson-row ${log.date===lessonDate?"selected":""}`} onClick={()=>setLessonDate(log.date)}><span className="l16-lesson-chip">{log.date.slice(5).replace("-","/")}</span><span style={{flex:1,minWidth:0}}><strong style={{fontSize:12,display:"block"}}>{log.classContent.split("\n")[0] || "수업 내용 미입력"}</strong><small style={{color:"#8290a4"}}>{log.nextPlan ? `다음: ${log.nextPlan.slice(0,48)}` : "다음 수업 계획을 기록해 주세요."}</small></span><Pencil size={14}/></button>)}</div>}
          {loading && <div style={{padding:16,color:"#8090a5",fontSize:12}}>학생·수업 기록을 불러오는 중입니다.</div>}
          <div style={{marginTop:16,paddingTop:15,borderTop:`1px solid ${line}`}}>
            <div className="l16-lesson-controls" style={{justifyContent:"space-between"}}><strong>{selectedStudent?.name ?? "학생"} 수업 내용</strong><input aria-label="수업 날짜" type="date" className="l16-lesson-input" style={{width:"auto"}} value={lessonDate} onChange={e=>{setLessonDate(e.target.value);setMonday(mondayOf(e.target.value));}}/></div>
            <label className="l16-lesson-label">오늘 수업한 내용</label><textarea className="l16-lesson-input" value={classContent} onChange={e=>setClassContent(e.target.value)} placeholder="오늘 다룬 교재·범위·핵심 개념·학생 반응을 기록하세요."/>
            <label className="l16-lesson-label">다음 수업에서 정리할 내용</label><textarea className="l16-lesson-input" value={nextPlan} onChange={e=>setNextPlan(e.target.value)} placeholder="다음 수업의 학습 내용과 확인할 지점을 적으세요."/>
            <label className="l16-lesson-label">이후 필요한 처리 사항</label>
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto auto",gap:7}}><input className="l16-lesson-input" value={newTask} onChange={e=>setNewTask(e.target.value)} placeholder="예: 지시어 추론 문제 5개 준비" onKeyDown={e=>e.key==="Enter"&&addTask()}/><input aria-label="처리 기한" className="l16-lesson-input" type="date" value={newTaskDue} onChange={e=>setNewTaskDue(e.target.value)} style={{width:145}}/><button className="l16-lesson-ghost" onClick={addTask}><Plus size={15}/>추가</button></div>
            {followUps.map(task=><div className="l16-lesson-task" key={task.id}><input aria-label={`${task.text} 완료`} type="checkbox" checked={task.done} onChange={e=>updateTask(task.id,{done:e.target.checked})}/><div style={{flex:1,fontSize:12,textDecoration:task.done?"line-through":"none",color:task.done?"#8995a7":ink}}>{task.text}<div style={{fontSize:10,color:"#8290a4",marginTop:3}}>{task.due?`기한 ${task.due}`:"기한 미지정"}</div></div><button className="l16-lesson-ghost" aria-label="후속 처리 삭제" onClick={()=>setFollowUps(prev=>prev.filter(t=>t.id!==task.id))}><X size={14}/></button></div>)}
            <label className="l16-lesson-label">수업 메모</label><textarea className="l16-lesson-input" style={{minHeight:68}} value={teacherMemo} onChange={e=>setTeacherMemo(e.target.value)} placeholder="상담·학생 반응·다음에 확인할 점"/>
            <div className="l16-lesson-controls" style={{marginTop:12}}><button className="l16-lesson-primary" onClick={()=>void saveLesson()} disabled={saving}><Save size={15}/>{saving?"저장 중":"수업 기록 저장"}</button><button className="l16-lesson-ghost" onClick={createLinkedMemo}><NotebookPen size={15}/>기존 메모장에 연결</button></div>
            <div style={{fontSize:10,color:"#8290a4",marginTop:8}}>수업 기록은 기존 teacher_logs 저장소에, 연결 메모는 L16 메모장 저장소에 각각 기록됩니다.</div>
          </div>
          <div className="l16-lesson-linked"><strong style={{fontSize:12}}>연결된 메모</strong>{memos.filter(m=>m.studentCode===studentCode&&m.lessonDate===lessonDate).length===0?<div style={{fontSize:11,color:"#7b899e",marginTop:6}}>이 수업과 연결된 메모가 없습니다.</div>:memos.filter(m=>m.studentCode===studentCode&&m.lessonDate===lessonDate).map(m=><div key={m.id} style={{fontSize:12,marginTop:6}}><FileText size={13} style={{verticalAlign:"middle",marginRight:5}}/>{m.title}</div>)}</div>
        </div>
      </section>

      <section className="l16-lesson-card exam">
        <div className="l16-lesson-head"><div><strong style={{fontSize:15}}>시험기간 준비 현황</strong><div style={{fontSize:11,color:"#7b899e",marginTop:4}}>시험 일정을 찾아 준비 계획과 진행 상황을 함께 관리합니다.</div></div><button className="l16-lesson-ghost" onClick={()=>setCompareOpen(true)} disabled={!activeExams.length}><Users size={15}/>시험기간 확인</button></div>
        <div className="l16-lesson-body">
          {periodGroups.length===0 ? <div style={{padding:18,textAlign:"center",color:"#8290a4",fontSize:12}}>예정된 시험 일정이 없습니다. 지난 시험은 표시하지 않으며, 새 시험은 시험일정 메뉴에서 등록해 주세요.</div> : <>
            <label className="l16-lesson-label" style={{marginTop:0}}>확인할 시험기간</label><select className="l16-lesson-input" value={activePeriod?.key ?? ""} onChange={e=>setPeriod(e.target.value)}>{periodGroups.map(g=><option key={g.key} value={g.key}>{periodName(g.exemplar)} · {g.rows.length}명</option>)}</select>
            {activeExams.map(exam=>{
              const related=plans.filter(p=>p.exam_id===exam.id||(p.student_code===exam.studentCode&&p.english_exam_date===exam.englishExamDate));
              const done=related.filter(p=>p.status==="done").length; const pending=related.filter(p=>p.status==="pending"||p.status==="adjusted");
              const today=dateKey(new Date()); const dayLeft=exam.englishExamDate?Math.ceil((new Date(`${exam.englishExamDate}T00:00:00`).getTime()-new Date(`${today}T00:00:00`).getTime())/86400000):null;
              return <div className="l16-lesson-period" key={exam.id} style={{marginTop:10}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"start"}}><div><strong style={{fontSize:13}}>{exam.name}</strong><div style={{fontSize:10,color:"#7b899e",marginTop:3}}>{exam.school} {exam.grade} · {exam.semester}학기 {exam.examType==="midterm"?"중간":"기말"} · {exam.subject}</div></div>{dayLeft!==null&&<span className="l16-lesson-chip">{dayLeft<0?`D+${Math.abs(dayLeft)}`:`D-${dayLeft}`}</span>}</div>
                <div style={{fontSize:11,color:"#52647d",lineHeight:1.6}}>시험기간 {exam.examStart||"미정"} ~ {exam.examEnd||"미정"}<br/>영어 시험 {exam.englishExamDate||"미정"} · 직보 {exam.reportDeadline||"미정"}<br/>범위 {exam.examRange||"미입력"}</div>
                <div style={{height:7,borderRadius:8,background:"#e9edf4",overflow:"hidden"}}><div style={{height:"100%",width:`${related.length?Math.round(done/related.length*100):0}%`,background:blue}}/></div>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#65758b"}}><span>{related.length?`준비 작업 ${done}/${related.length} 완료`:"준비 계획 미생성"}</span><span>{pending.length?`${pending.length}건 남음`:related.length?"모든 항목 완료":""}</span></div>
                {related.slice(0,3).map(p=><div key={p.id} style={{display:"flex",alignItems:"center",gap:7,fontSize:11}}><span style={{flex:1}}>{p.task_label}</span><select aria-label={`${p.task_label} 상태`} className="l16-lesson-input" style={{width:98,padding:"5px 6px",fontSize:11}} value={p.status} onChange={e=>void updatePlan(p,e.target.value as PrepPlan["status"])}><option value="pending">대기</option><option value="done">완료</option><option value="skipped">건너뜀</option><option value="adjusted">조정됨</option></select></div>)}
                {related.length>3&&<div style={{fontSize:10,color:"#7b899e"}}>외 {related.length-3}개 준비 작업 · 시험기간 확인 창에서 전체 보기</div>}
                <button className="l16-lesson-ghost l16-lesson-mobile-full" onClick={()=>{setEditExam(exam);setExamDraft({...exam});}}><Pencil size={14}/>일정·범위 수정</button>
              </div>;
            })}
            <div className="l16-lesson-note">학생 간 비교는 시험일까지 남은 기간, 준비 작업 완료율, 수업 기록 횟수, 후속 처리 건수를 나란히 보여줍니다. 학업 능력 순위나 성적 비교로 사용하지 않습니다.</div>
          </>}
        </div>
      </section>
    </div>

    {compareOpen&&<div className="l16-lesson-modal" role="dialog" aria-modal="true" aria-label="시험기간 학습 현황 비교" onMouseDown={e=>{if(e.target===e.currentTarget)setCompareOpen(false);}}><div className="l16-lesson-modalbox"><div className="l16-lesson-head"><div><strong style={{fontSize:18}}>시험기간 학습 현황 비교</strong><div style={{fontSize:11,color:"#7b899e",marginTop:4}}>{activePeriod?periodName(activePeriod.exemplar):""} · 같은 기간 학생들의 준비 진행과 다음 일정을 확인합니다.</div></div><button className="l16-lesson-ghost" aria-label="비교 창 닫기" onClick={()=>setCompareOpen(false)}><X size={17}/></button></div><div className="l16-lesson-body">
      <div className="l16-lesson-stats"><div className="l16-lesson-stat"><strong>{compareRows.length}명</strong><div style={{fontSize:10,color:"#7b899e"}}>비교 학생</div></div><div className="l16-lesson-stat"><strong>{compareRows.filter(r=>r.percent!==null).length}명</strong><div style={{fontSize:10,color:"#7b899e"}}>준비 계획 생성</div></div><div className="l16-lesson-stat"><strong>{compareRows.reduce((n,r)=>n+r.pendingCount,0)}건</strong><div style={{fontSize:10,color:"#7b899e"}}>전체 미완료 후속 처리</div></div></div>
      <div className="l16-lesson-tablewrap"><table className="l16-lesson-table"><thead><tr><th>학생</th><th>시험일</th><th>준비 단계</th><th>계획 진행</th><th>준비 수업 기록</th><th>미완료 후속 처리</th><th>다음 일정</th><th>관리</th></tr></thead><tbody>{compareRows.map(({exam,related,lessonCount,pendingCount,done,percent})=><tr key={exam.id}><td><strong>{exam.name}</strong><div style={{fontSize:10,color:"#8290a4"}}>{exam.school} {exam.grade}</div></td><td>{exam.englishExamDate||"미정"}</td><td>{related.length?`${Math.max(...related.map(p=>p.week_number))}주 준비`:"계획 미생성"}</td><td>{percent===null?"–":<><span>{done}/{related.length} · {percent}%</span><div style={{height:5,width:75,background:"#e9edf4",borderRadius:5,marginTop:4}}><div style={{height:"100%",width:`${percent}%`,background:blue,borderRadius:5}}/></div></>}</td><td>{lessonCount}회</td><td style={{color:pendingCount?"#b36a11":"#178258"}}>{pendingCount}건</td><td>{exam.nextLessonDate||exam.reportDeadline||"미정"}</td><td><button className="l16-lesson-ghost" onClick={()=>{setEditExam(exam);setExamDraft({...exam});setCompareOpen(false);}}><Pencil size={13}/>수정</button></td></tr>)}</tbody></table></div>
      <p style={{fontSize:10,color:"#7b899e",margin:"10px 0 0"}}>계획이 없는 학생은 진행률을 0%로 처리하지 않고 ‘계획 미생성’으로 표시합니다. 비교 자료는 관리 목적이며 순위표가 아닙니다.</p>
    </div></div></div>}

    {editExam&&examDraft&&<div className="l16-lesson-modal" role="dialog" aria-modal="true" aria-label="시험 준비 일정 수정" onMouseDown={e=>{if(e.target===e.currentTarget){setEditExam(null);setExamDraft(null);}}}><div className="l16-lesson-modalbox" style={{maxWidth:620}}><div className="l16-lesson-head"><div><strong style={{fontSize:17}}>시험 준비 일정 수정</strong><div style={{fontSize:11,color:"#7b899e",marginTop:4}}>{editExam.name} · {periodName(editExam)}</div></div><button className="l16-lesson-ghost" aria-label="수정 창 닫기" onClick={()=>{setEditExam(null);setExamDraft(null);}}><X size={17}/></button></div><div className="l16-lesson-body" style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"0 12px"}}>
      {([["examStart","시험기간 시작일"],["examEnd","시험기간 종료일"],["englishExamDate","영어 시험일"],["reportDeadline","직보일"],["nextLessonDate","다음 수업 예정일"]] as const).map(([key,label])=><label key={key} className="l16-lesson-label">{label}<input type="date" className="l16-lesson-input" value={examDraft[key]} onChange={e=>setExamDraft({...examDraft,[key]:e.target.value})}/></label>)}
      <label className="l16-lesson-label" style={{gridColumn:"1/-1"}}>시험 범위<textarea className="l16-lesson-input" value={examDraft.examRange} onChange={e=>setExamDraft({...examDraft,examRange:e.target.value})}/></label><label className="l16-lesson-label" style={{gridColumn:"1/-1"}}>준비 메모<textarea className="l16-lesson-input" value={examDraft.memo} onChange={e=>setExamDraft({...examDraft,memo:e.target.value})}/></label>
      <div style={{gridColumn:"1/-1",display:"flex",justifyContent:"end",gap:8,marginTop:12}}><button className="l16-lesson-ghost" onClick={()=>{setEditExam(null);setExamDraft(null);}}>취소</button><button className="l16-lesson-primary" onClick={()=>void saveExamSchedule()}><Save size={14}/>일정 저장</button></div>
    </div></div></div>}
  </div>;
}


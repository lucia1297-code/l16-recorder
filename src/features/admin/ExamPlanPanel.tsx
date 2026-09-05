import { useEffect, useState, useMemo } from "react";
import { loadLocalExams, supabaseToUnified, mergeExams } from "../../lib/examUtils";
import type { UnifiedExam } from "../../lib/examUtils";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";
import { CheckCircle, Circle, AlertCircle, RefreshCw, ChevronDown, ChevronUp, Calendar, BookOpen, FileText, ClipboardList, Layers, Zap, SkipForward } from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

// ── 타입 ──────────────────────────────────────────────
// StudentExam → UnifiedExam (examUtils.ts)

interface ExamPlan {
  id: string;
  student_code: string;
  student_name: string;
  school: string;
  grade: string;
  exam_id: string;
  exam_name: string;
  english_exam_date: string;
  week_number: number;
  task_key: string;
  task_label: string;
  task_detail: string;
  status: "pending" | "done" | "skipped" | "adjusted";
  adjusted_note: string;
  alt_material: string;
}

// ── 주차별 준비물 템플릿 ──────────────────────────────
interface TaskTemplate {
  key: string;
  label: string;
  detail: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

const WEEK_TEMPLATES: Record<number, TaskTemplate[]> = {
  4: [ // 4주 전
    { key:"lecture_ch1", label:"교과서 1차 강의", detail:"시험 범위 전체 교과서 진도 1회독 — 핵심 문법·어휘 정리", icon:<BookOpen size={14}/>, color:"#2563eb", bg:"#dbeafe" },
    { key:"vocab_list", label:"어휘 목록 작성", detail:"시험 범위 핵심 어휘 추출 및 암기 목록 배부", icon:<FileText size={14}/>, color:"#7c3aed", bg:"#ede9fe" },
    { key:"grammar_review", label:"어법 핵심 정리", detail:"출제 가능 어법 포인트 5가지 선별·정리", icon:<ClipboardList size={14}/>, color:"#0891b2", bg:"#cffafe" },
  ],
  3: [ // 3주 전
    { key:"problem_1st", label:"1차 문제풀이", detail:"교과서 단원평가 + 기출 유형별 문제 1회 풀이", icon:<Layers size={14}/>, color:"#059669", bg:"#d1fae5" },
    { key:"workbook_1st", label:"워크북 1차", detail:"워크북 전 범위 1회차 풀이 — 오답 체크", icon:<BookOpen size={14}/>, color:"#d97706", bg:"#fef3c7" },
    { key:"mock_variation_1st", label:"변형 모의고사 1차", detail:"수능형 변형 문제 1세트 풀이 (18~45번)", icon:<Zap size={14}/>, color:"#dc2626", bg:"#fee2e2" },
  ],
  2: [ // 2주 전
    { key:"prelim_exam", label:"예비 시험지", detail:"예상 문제 시험지 (학교 내신 스타일) 실전 풀이", icon:<FileText size={14}/>, color:"#7c3aed", bg:"#ede9fe" },
    { key:"workbook_2nd", label:"워크북 2차", detail:"워크북 오답 위주 2회차 집중 복습", icon:<BookOpen size={14}/>, color:"#d97706", bg:"#fef3c7" },
    { key:"mock_variation_2nd", label:"변형 모의고사 2차", detail:"수능형 변형 문제 2세트 풀이 + 오답 분석", icon:<Zap size={14}/>, color:"#dc2626", bg:"#fee2e2" },
    { key:"lecture_ch2", label:"교과서 2차 강의", detail:"취약 단원 집중 재강의 — 실전 적용 훈련", icon:<BookOpen size={14}/>, color:"#2563eb", bg:"#dbeafe" },
  ],
  1: [ // 1주 전
    { key:"workbook_3rd", label:"워크북 3차 (최종)", detail:"워크북 3회차 — 전 범위 빠른 복습 + 실수 체크", icon:<BookOpen size={14}/>, color:"#d97706", bg:"#fef3c7" },
    { key:"final_mock", label:"최종 모의 시험", detail:"실전 시험지 풀이 (시간 엄수) → 직후 오답 분석", icon:<Zap size={14}/>, color:"#dc2626", bg:"#fee2e2" },
    { key:"vocab_final", label:"어휘 최종 점검", detail:"암기 어휘 전체 테스트 → 취약 어휘 집중 암기", icon:<FileText size={14}/>, color:"#7c3aed", bg:"#ede9fe" },
    { key:"day_before", label:"전날 최종 정리", detail:"핵심 포인트 한 장 정리 + 멘탈 관리", icon:<Layers size={14}/>, color:"#059669", bg:"#d1fae5" },
  ],
};

const ALT_MATERIALS: Record<string, string[]> = {
  lecture_ch1: ["EBS 수능특강 해당 단원", "온라인 인강 자료", "요약 프린트 배부"],
  problem_1st: ["수능 기출 문제집", "학교 기출 문제", "시중 내신 문제집"],
  workbook_1st: ["부교재 문제", "프린트 추가 문제", "온라인 문제풀이"],
  prelim_exam: ["모의고사 변형 세트", "타 학교 기출", "강사 자체 제작 시험지"],
  mock_variation_1st: ["EBS 변형 문제", "시중 변형 교재", "직접 제작 변형 문제"],
  mock_variation_2nd: ["고난도 변형 세트", "수능 실전 모의고사", "오답 기반 재구성"],
  final_mock: ["작년 학교 기출 시험지", "타 학교 동일 시험 기출", "자체 제작 예상 시험지"],
};

const STATUS_LABEL: Record<string, string> = {
  pending: "대기", done: "완료", skipped: "건너뜀", adjusted: "조정됨"
};

function daysLeft(dateStr: string) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function weekLabel(wk: number) {
  return wk === 4 ? "D-28 ~ D-22 (4주 전)" :
    wk === 3 ? "D-21 ~ D-15 (3주 전)" :
    wk === 2 ? "D-14 ~ D-8 (2주 전)" : "D-7 ~ D-1 (1주 전)";
}

function currentWeek(dateStr: string): number {
  const d = daysLeft(dateStr) ?? 99;
  if (d >= 22) return 4;
  if (d >= 15) return 3;
  if (d >= 8) return 2;
  return 1;
}

export default function ExamPlanPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [exams, setExams] = useState<UnifiedExam[]>([]);
  const [plans, setPlans] = useState<ExamPlan[]>([]);
  const [loading, setLoading] = useState(true);

  // 필터
  const [filterStudent, setFilterStudent] = useState("");
  const [filterSchool, setFilterSchool] = useState("");
  const [filterGrade, setFilterGrade] = useState("");
  const [filterWeek, setFilterWeek] = useState<number | "">("");

  // UI 상태
  const [expandedExam, setExpandedExam] = useState<string | null>(null);
  const [adjustModal, setAdjustModal] = useState<ExamPlan | null>(null);
  const [adjustNote, setAdjustNote] = useState("");
  const [altMaterial, setAltMaterial] = useState("");
  const [notice, setNotice] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    // roster 먼저 로드 → 완료 후 loadAll (학생 이름/학교/학년 매핑 필요)
    rosterStore.listRoster().then(r => {
      setRoster(r);
      loadAll(r);  // roster를 인자로 전달
    });
  }, []);

  // roster가 로드된 후 시험 목록 구성 (examUtils.ts 사용)
  async function loadAll(currentRoster?: RosterEntry[]) {
    setLoading(true);
    const rosterToUse = currentRoster ?? roster;
    try {
      // 1. localStorage → examUtils.loadLocalExams (필드명 변환 통합 관리)
      const localExams = loadLocalExams(rosterToUse);

      // 2. Supabase → examUtils.supabaseToUnified
      let sbExams: UnifiedExam[] = [];
      try {
        const sbRes = await fetch(
          `${SUPABASE_URL}/rest/v1/student_exams?order=english_exam_date.asc`,
          { headers: SB_H }
        );
        if (!sbRes.ok) throw new Error(`Supabase ${sbRes.status}`);
        const sbData = await sbRes.json().catch(() => []);
        if (Array.isArray(sbData)) {
          sbExams = sbData.map((se: any) => supabaseToUnified(se, rosterToUse));
        }
      } catch(e) { console.error("Supabase 조회 오류:", e); }

      // 3. 통합 (examUtils.mergeExams - 중복 제거 + 정렬)
      const allExams = mergeExams(localExams, sbExams);
      console.log(`시험 로딩: 로컬 ${localExams.length}건 + Supabase ${sbExams.length}건 = 총 ${allExams.length}건`);
      console.log("시험 목록:", allExams.map(e => `${e.student_name} / ${e.english_exam_date || "날짜없음"}`));
      setExams(allExams);

      // 4. 계획 로딩
      const pRes = await fetch(
        `${SUPABASE_URL}/rest/v1/exam_prep_plans?order=english_exam_date.asc,week_number.asc`,
        { headers: SB_H }
      );
      if (pRes.ok) {
        const pData = await pRes.json().catch(() => []);
        setPlans(Array.isArray(pData) ? pData : []);
      }
    } catch(err) { console.error("loadAll 오류:", err); }
    setLoading(false);
  }

  async function generatePlan(exam: UnifiedExam) {
    setGenerating(exam.id);
    try {
      // 이미 생성된 계획 삭제
      await fetch(`${SUPABASE_URL}/rest/v1/exam_prep_plans?exam_id=eq.${exam.id}`, {
        method: "DELETE", headers: SB_H,
      }).catch(e => console.warn("기존 계획 삭제 실패:", e));

      const examName = `${exam.semester}학기 ${exam.exam_type === "midterm" ? "중간" : "기말"}고사`;
      const newPlans = [];
      for (const [wkStr, tasks] of Object.entries(WEEK_TEMPLATES)) {
        const wk = Number(wkStr);
        for (const task of tasks) {
          newPlans.push({
            student_code: exam.student_code,
            student_name: exam.student_name,
            school: exam.school,
            grade: exam.grade,
            exam_id: exam.id,
            exam_name: examName,
            english_exam_date: exam.english_exam_date,
            week_number: wk,
            task_key: task.key,
            task_label: task.label,
            task_detail: task.detail,
            status: "pending",
            adjusted_note: "",
            alt_material: "",
          });
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/exam_prep_plans`, {
        method: "POST",
        headers: { ...SB_H, "Prefer": "return=minimal" },
        body: JSON.stringify(newPlans),
      });

      setNotice(` ${exam.student_name} 시험대비 계획 생성 완료!`);
      setTimeout(() => setNotice(""), 4000);
      await loadAll();
      setExpandedExam(exam.id);
    } catch(e: any) { setNotice("생성 실패: " + (e?.message ?? String(e))); console.error("[ExamPlan] 생성 오류:", e); }
    setGenerating(null);
  }

  async function updateStatus(plan: ExamPlan, status: ExamPlan["status"]) {
    try { await fetch(`${SUPABASE_URL}/rest/v1/exam_prep_plans?id=eq.${plan.id}`, {
      method: "PATCH", headers: SB_H,
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    }); } catch(e) { console.warn("상태 업데이트 실패:", e); }
    setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, status } : p));

    if (status === "done") {
      // 다음 할 일 찾기
      const examPlans = plans.filter(p => p.exam_id === plan.exam_id && p.id !== plan.id);
      const next = examPlans.find(p => p.week_number === plan.week_number && p.status === "pending")
        || examPlans.find(p => p.week_number > plan.week_number && p.status === "pending");
      if (next) {
        setNotice(`완료! 다음 → 「${next.task_label}」 을 준비해주세요.`);
        setTimeout(() => setNotice(""), 5000);
      } else {
        setNotice(" 이 주차 모든 준비 완료!");
        setTimeout(() => setNotice(""), 4000);
      }
    }
  }

  async function saveAdjust() {
    if (!adjustModal) return;
    await fetch(`${SUPABASE_URL}/rest/v1/exam_prep_plans?id=eq.${adjustModal.id}`, {
      method: "PATCH", headers: SB_H,
      body: JSON.stringify({
        status: "adjusted",
        adjusted_note: adjustNote,
        alt_material: altMaterial,
        updated_at: new Date().toISOString(),
      }),
    });
    setPlans(prev => prev.map(p => p.id === adjustModal.id
      ? { ...p, status: "adjusted", adjusted_note: adjustNote, alt_material: altMaterial } : p));
    setAdjustModal(null); setAdjustNote(""); setAltMaterial("");
    setNotice("일정이 조정됐습니다."); setTimeout(() => setNotice(""), 3000);
  }

  // 필터링
  const schools = [...new Set(exams.map(e => e.school).filter(Boolean))];
  const grades = [...new Set(exams.map(e => e.grade).filter(Boolean))];

  const filteredExams = exams.filter(e =>
    (!filterStudent || e.student_code === filterStudent) &&
    (!filterSchool || e.school === filterSchool) &&
    (!filterGrade || e.grade === filterGrade)
  );

  // 진행률 계산
  function progress(examId: string) {
    const ep = plans.filter(p => p.exam_id === examId);
    const done = ep.filter(p => p.status === "done").length;
    return { total: ep.length, done };
  }

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16, flexWrap:"wrap", gap:10 }}>
        <div>
          <h2 style={{ margin:0, color:"#7c3aed", display:"flex", alignItems:"center", gap:8 }}>
            시험대비 계획
          </h2>
          <p style={{ fontSize:12, color:"#64748b", margin:"4px 0 0" }}>
            학생별 시험 준비 단계를 주차별로 관리합니다.
          </p>
        </div>
        <button onClick={() => loadAll()}
          style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 12px",
            borderRadius:8, border:"1px solid #e2e8f0", background:"#fff",
            fontSize:12, cursor:"pointer" }}>
          새로고침
        </button>
      </div>

      {notice && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:12, fontWeight:600, fontSize:13,
          background: notice.startsWith("")||notice.startsWith("") ? "#f0fdf4" : "#fef3c7",
          border:`1px solid ${notice.startsWith("")||notice.startsWith("") ? "#86efac" : "#fde68a"}`,
          color: notice.startsWith("")||notice.startsWith("") ? "#166534" : "#92400e" }}>
          {notice}
        </div>
      )}

      {/* 필터 */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16,
        padding:"12px 14px", background:"#f8fafc", borderRadius:10, border:"1px solid #e2e8f0" }}>
        <select value={filterStudent} onChange={e => {
            const code = e.target.value;
            setFilterStudent(code);
            if (code) {
              // 해당 학생 시험을 자동 펼침
              const firstExam = exams.find(ex => ex.student_code === code);
              if (firstExam) setExpandedExam(firstExam.id);
            }
          }}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
          <option value="">전체 학생</option>
          {roster.filter(r=>(r.studentStatus??"active")!=="withdrawn")
            .map(r => <option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
        </select>
        <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
          <option value="">전체 학교</option>
          {schools.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterGrade} onChange={e => setFilterGrade(e.target.value)}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
          <option value="">전체 학년</option>
          {grades.map(g => <option key={g} value={g}>{g}학년</option>)}
        </select>
        <select value={filterWeek} onChange={e => setFilterWeek(e.target.value ? Number(e.target.value) : "")}
          style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
          <option value="">전체 주차</option>
          <option value="4">4주 전</option>
          <option value="3">3주 전</option>
          <option value="2">2주 전</option>
          <option value="1">1주 전</option>
        </select>
      </div>

      {loading ? (
        <p style={{ color:"#94a3b8", textAlign:"center", padding:"30px 0" }}>로딩 중…</p>
      ) : filteredExams.length === 0 ? (
        <div style={{ textAlign:"center", padding:"40px 20px", color:"#94a3b8" }}>
          <p style={{ fontWeight:600, fontSize:14 }}>표시할 시험 일정이 없습니다.</p>
          <p style={{ fontSize:12, marginTop:6 }}>
            다음 중 하나를 확인해주세요:<br/>
            1. <strong>시험일정조사</strong> 탭 → 학생이 등록한 시험 확인<br/>
            2. <strong>시험일정조사</strong> 탭 → 관리자가 직접 시험 일정 추가<br/>
            3. 필터 조건이 너무 좁을 경우 필터를 초기화해보세요.
          </p>
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {filteredExams.map(exam => {
            const dl = daysLeft(exam.english_exam_date);
            const urgent = dl !== null && dl >= 0 && dl <= 14;
            const overdue = dl !== null && dl < 0;
            const { total, done } = progress(exam.id);
            const pct = total > 0 ? Math.round(done/total*100) : 0;
            const examPlans = plans.filter(p => p.exam_id === exam.id);
            const hasPlans = examPlans.length > 0;
            const curWeek = dl !== null && dl >= 0 ? currentWeek(exam.english_exam_date) : null;

            return (
              <div key={exam.id} style={{ border:`1.5px solid ${
                overdue?"#e2e8f0":urgent?"#fca5a5":"#e0e7ff"}`,
                borderRadius:14, overflow:"hidden",
                background: overdue?"#fafafa":urgent?"#fff5f5":"#fff" }}>

                {/* 시험 헤더 */}
                <div style={{ padding:"12px 16px",
                  background: overdue?"#f1f5f9":urgent?"#fef2f2":"#f5f3ff",
                  borderBottom:"1px solid #e2e8f0",
                  display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span style={{ fontWeight:700, fontSize:16, color:"#1e293b" }}>{exam.student_name}</span>
                        <span style={{ fontSize:11, padding:"2px 8px", borderRadius:8,
                          background:"#ede9fe", color:"#7c3aed", fontWeight:600 }}>
                          {exam.school} {exam.grade}학년
                        </span>
                        <span style={{ fontSize:11, padding:"2px 8px", borderRadius:8,
                          background:"#f1f5f9", color:"#475569", fontWeight:600 }}>
                          {exam.semester}학기 {exam.exam_type==="midterm"?"중간":"기말"}
                        </span>
                        {dl !== null && (
                          <span style={{ fontSize:13, fontWeight:700,
                            color: overdue?"#94a3b8":urgent?"#dc2626":"#7c3aed" }}>
                            {overdue ? `D+${Math.abs(dl)}` : `D-${dl}`}
                          </span>
                        )}
                        {curWeek && !overdue && (
                          <span style={{ fontSize:11, padding:"2px 8px", borderRadius:6,
                            background:"#7c3aed", color:"#fff", fontWeight:600 }}>
                            현재 {curWeek}주 전
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize:11, color:"#94a3b8", marginTop:2 }}>
                        영어 시험일: {exam.english_exam_date} &nbsp;|&nbsp; 범위: {exam.exam_range||"-"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    {/* 진행률 */}
                    {hasPlans && (
                      <div style={{ textAlign:"center", minWidth:70 }}>
                        <div style={{ fontSize:11, color:"#64748b", marginBottom:3 }}>
                          진행률 {done}/{total}
                        </div>
                        <div style={{ height:6, background:"#e2e8f0", borderRadius:3, width:70 }}>
                          <div style={{ width:`${pct}%`, height:6, borderRadius:3,
                            background: pct===100?"#059669":pct>=50?"#7c3aed":"#f97316" }} />
                        </div>
                        <div style={{ fontSize:10, color:"#7c3aed", fontWeight:700, marginTop:2 }}>{pct}%</div>
                      </div>
                    )}
                    <button onClick={() => generatePlan(exam)} disabled={generating===exam.id}
                      style={{ padding:"6px 14px", borderRadius:8, border:"none",
                        background: generating===exam.id?"#e2e8f0":"#7c3aed",
                        color: generating===exam.id?"#94a3b8":"#fff",
                        fontWeight:700, fontSize:12, cursor: generating===exam.id?"not-allowed":"pointer" }}>
                      {generating===exam.id?"생성 중…":hasPlans?"재생성":"계획 생성"}
                    </button>
                    {hasPlans && (
                      <button onClick={() => setExpandedExam(expandedExam===exam.id?null:exam.id)}
                        style={{ padding:"6px 10px", borderRadius:8, border:"1px solid #e2e8f0",
                          background:"#fff", fontSize:12, cursor:"pointer",
                          display:"flex", alignItems:"center" }}>
                        {expandedExam===exam.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                      </button>
                    )}
                  </div>
                </div>

                {/* 계획 내용 */}
                {expandedExam===exam.id && hasPlans && (
                  <div style={{ padding:"14px 16px" }}>
                    {([4,3,2,1] as const)
                      .filter(wk => !filterWeek || filterWeek===wk)
                      .map(wk => {
                        const wkPlans = examPlans.filter(p => p.week_number===wk);
                        if (wkPlans.length===0) return null;
                        const wkDone = wkPlans.filter(p=>p.status==="done").length;
                        const isCurrent = curWeek===wk;

                        return (
                          <div key={wk} style={{ marginBottom:16 }}>
                            {/* 주차 헤더 */}
                            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                              <span style={{ fontSize:12, fontWeight:700, padding:"3px 12px", borderRadius:20,
                                background: isCurrent?"#7c3aed":"#f1f5f9",
                                color: isCurrent?"#fff":"#64748b",
                                whiteSpace:"nowrap" }}>
                                {isCurrent&&""}{weekLabel(wk)} ({wkDone}/{wkPlans.length})
                              </span>
                              </div>

                            {/* 태스크 목록 */}
                            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                              {wkPlans.map((plan, pi) => {
                                const tmpl = WEEK_TEMPLATES[wk]?.find(t=>t.key===plan.task_key);
                                const isDone = plan.status==="done";
                                const isAdj = plan.status==="adjusted";
                                const isSkip = plan.status==="skipped";
                                const isPrev = wk > (curWeek??99);

                                return (
                                  <div key={plan.id} style={{ display:"flex", gap:10, alignItems:"flex-start",
                                    padding:"10px 12px", borderRadius:10,
                                    background: isDone?"#f0fdf4":isAdj?"#fef3c7":isSkip?"#f8fafc":"#fff",
                                    border:`1px solid ${isDone?"#86efac":isAdj?"#fde68a":isSkip?"#e2e8f0":"#e0e7ff"}`,
                                    opacity: isSkip?0.6:1 }}>

                                    {/* 순서 번호 */}
                                    <div style={{ minWidth:24, height:24, borderRadius:"50%", display:"flex",
                                      alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700,
                                      background: isDone?"#059669":isAdj?"#d97706":"#7c3aed", color:"#fff" }}>
                                      {pi+1}
                                    </div>

                                    {/* 내용 */}
                                    <div style={{ flex:1 }}>
                                      <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", marginBottom:3 }}>
                                        <span style={{ display:"flex", alignItems:"center", gap:4,
                                          fontSize:11, padding:"2px 7px", borderRadius:6,
                                          background: tmpl?.bg??"#f1f5f9", color: tmpl?.color??"#64748b",
                                          fontWeight:600 }}>
                                          {tmpl?.icon} {plan.task_label}
                                        </span>
                                        <span style={{ fontSize:10, padding:"1px 6px", borderRadius:5, fontWeight:600,
                                          background: isDone?"#d1fae5":isAdj?"#fef3c7":isSkip?"#f1f5f9":"#ede9fe",
                                          color: isDone?"#059669":isAdj?"#d97706":isSkip?"#94a3b8":"#7c3aed" }}>
                                          {STATUS_LABEL[plan.status]}
                                        </span>
                                      </div>
                                      <p style={{ fontSize:12, color:"#475569", margin:"2px 0", lineHeight:1.5 }}>
                                        {plan.task_detail}
                                      </p>
                                      {plan.adjusted_note && (
                                        <p style={{ fontSize:11, color:"#d97706", margin:"3px 0",
                                          background:"#fef3c7", padding:"3px 8px", borderRadius:5 }}>
                                          {plan.adjusted_note}
                                        </p>
                                      )}
                                      {plan.alt_material && (
                                        <p style={{ fontSize:11, color:"#0891b2", margin:"3px 0" }}>
                                          대체 자료: {plan.alt_material}
                                        </p>
                                      )}
                                    </div>

                                    {/* 액션 버튼 */}
                                    <div style={{ display:"flex", flexDirection:"column", gap:5, minWidth:60 }}>
                                      {!isDone && !isSkip && (
                                        <button onClick={() => updateStatus(plan, "done")}
                                          style={{ display:"flex", alignItems:"center", gap:3,
                                            padding:"4px 8px", borderRadius:6, border:"none",
                                            background:"#059669", color:"#fff",
                                            fontSize:10, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>
                                          완료
                                        </button>
                                      )}
                                      {isDone && (
                                        <button onClick={() => updateStatus(plan, "pending")}
                                          style={{ display:"flex", alignItems:"center", gap:3,
                                            padding:"4px 8px", borderRadius:6, border:"1px solid #e2e8f0",
                                            background:"#fff", color:"#64748b",
                                            fontSize:10, cursor:"pointer", whiteSpace:"nowrap" }}>
                                          취소
                                        </button>
                                      )}
                                      {!isDone && (
                                        <button onClick={() => {
                                          setAdjustModal(plan);
                                          setAdjustNote(plan.adjusted_note);
                                          setAltMaterial(plan.alt_material);
                                        }}
                                          style={{ display:"flex", alignItems:"center", gap:3,
                                            padding:"4px 8px", borderRadius:6, border:"1px solid #fde68a",
                                            background:"#fef3c7", color:"#d97706",
                                            fontSize:10, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>
                                          조정
                                        </button>
                                      )}
                                      {!isSkip && !isDone && (
                                        <button onClick={() => updateStatus(plan, "skipped")}
                                          style={{ display:"flex", alignItems:"center", gap:3,
                                            padding:"4px 8px", borderRadius:6, border:"1px solid #e2e8f0",
                                            background:"#fff", color:"#94a3b8",
                                            fontSize:10, cursor:"pointer", whiteSpace:"nowrap" }}>
                                          건너뜀
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 일정 조정 모달 */}
      {adjustModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:500,
          display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:"#fff", borderRadius:14, padding:24, width:"100%", maxWidth:420,
            boxShadow:"0 8px 40px rgba(0,0,0,0.2)" }}>
            <h3 style={{ margin:"0 0 4px", color:"#7c3aed" }}>일정 조정</h3>
            <p style={{ fontSize:12, color:"#64748b", marginBottom:14 }}>
              「{adjustModal.task_label}」 항목을 조정합니다.
            </p>

            <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
              조정 사유 / 새 일정
            </label>
            <textarea value={adjustNote} onChange={e => setAdjustNote(e.target.value)} rows={3}
              placeholder="예) 다음 주 수업으로 이동, 범위 축소 등"
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #7c3aed",
                fontSize:13, resize:"none" as const, boxSizing:"border-box" as const, marginBottom:12 }} />

            <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>
              대체 자료 선택
            </label>
            <select value={altMaterial} onChange={e => setAltMaterial(e.target.value)}
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0",
                fontSize:13, marginBottom:8 }}>
              <option value="">-- 대체 자료 선택 --</option>
              {(ALT_MATERIALS[adjustModal.task_key] ?? []).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="직접 입력">직접 입력</option>
            </select>
            {altMaterial === "직접 입력" && (
              <input value={altMaterial} onChange={e => setAltMaterial(e.target.value)}
                placeholder="대체 자료명 입력"
                style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #e2e8f0",
                  fontSize:13, marginBottom:8, boxSizing:"border-box" as const }} />
            )}

            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <button onClick={saveAdjust}
                style={{ flex:1, padding:11, borderRadius:8, border:"none",
                  background:"#7c3aed", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer" }}>
                저장
              </button>
              <button onClick={() => { setAdjustModal(null); setAdjustNote(""); setAltMaterial(""); }}
                style={{ flex:1, padding:11, borderRadius:8, border:"1px solid #e2e8f0",
                  background:"#fff", fontSize:14, cursor:"pointer" }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

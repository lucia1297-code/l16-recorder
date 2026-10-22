/**
 * HELIX 오늘의 판단 패널
 * Evidence → 가설 → 처방 → 재검증 폐쇄 루프를 교사가 빠르게 운영하는 화면
 *
 * 설계 원칙 (인계서 기반):
 * - 기존 L16 기능 위에 HELIX를 "상위 지능 계층"으로 얹는다
 * - HELIX 메뉴는 이 패널 하나. 나머지는 기존 메뉴의 배지·열로 표현
 * - 의료 시스템처럼 과도하게 복잡하지 않게 — 교사가 빠르게 이해할 수 있는 한국어 UI
 */

import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// ── 타입 ──────────────────────────────────────────────────────────────────
type EvidenceKind = "submission" | "score" | "assignment" | "teacher_note";
type EvidenceStance = "supporting" | "against" | "neutral";
type ConfidenceLevel = "낮음" | "보통" | "높음";
type LoopPhase = "evidence" | "hypothesis" | "prescription" | "recheck";
type PrescriptionStatus = "draft" | "approved" | "applied" | "rechecking";

interface Evidence {
  id: string;
  studentCode: string;
  kind: EvidenceKind;
  stance: EvidenceStance;
  summary: string;
  detail?: string;
  date: string;
  confidence: ConfidenceLevel;
}

interface HelixStudent {
  code: string;
  name: string;
  school: string;
  grade: string;
  ldna: string;           // 학생 학습 유전자 패턴 요약
  phase: LoopPhase;       // 현재 루프 단계
  prescriptionStatus?: PrescriptionStatus;
  urgency: "high" | "normal" | "low";
  evidences: Evidence[];
  hypothesis?: string;
  prescription?: string;
  prescriptionDate?: string;
  recheckNote?: string;
  assignmentCount?: number;
  lastSubmit?: string;
}

// ── 더미 데이터 (실제 구현에서는 Supabase에서 가져옴) ─────────────────────
const DUMMY_STUDENTS: HelixStudent[] = [
  {
    code: "A001",
    name: "이예린",
    school: "한빛고",
    grade: "3",
    ldna: "감지→실행 강, 추론 약. 지문 읽기 속도 느림. 시간 압박에 오류 급증.",
    phase: "prescription",
    prescriptionStatus: "draft",
    urgency: "high",
    lastSubmit: "2026-10-20",
    assignmentCount: 3,
    evidences: [
      { id: "e1", studentCode: "A001", kind: "score", stance: "against",   summary: "9월 모의 2등급 → 10월 3등급", date: "2026-10-15", confidence: "높음" },
      { id: "e2", studentCode: "A001", kind: "assignment", stance: "against", summary: "과제 제출률 58% (7일 평균)", date: "2026-10-18", confidence: "보통" },
      { id: "e3", studentCode: "A001", kind: "teacher_note", stance: "supporting", summary: "수업 중 발표 참여 증가", date: "2026-10-19", confidence: "낮음" },
    ],
    hypothesis: "성적 하락의 주 원인은 시간 관리 실패. 과제 미제출이 개념 복습을 막고 있음.",
    prescription: "① 매주 단어 테스트 30문항 시간 재기 연습\n② 과제 제출 미비 시 당일 알림 발송\n③ 독해 지문 1편/일 타이머 훈련",
  },
  {
    code: "B003",
    name: "강지훈",
    school: "서울고",
    grade: "3",
    ldna: "개념 이해 강, 적용 약. 선지 소거 빠르나 오답 패턴 반복.",
    phase: "recheck",
    prescriptionStatus: "applied",
    urgency: "normal",
    lastSubmit: "2026-10-21",
    assignmentCount: 1,
    evidences: [
      { id: "e4", studentCode: "B003", kind: "score", stance: "supporting", summary: "10월 모의 1등급 유지", date: "2026-10-15", confidence: "높음" },
      { id: "e5", studentCode: "B003", kind: "assignment", stance: "neutral", summary: "과제 제출 정상", date: "2026-10-20", confidence: "보통" },
    ],
    hypothesis: "오답 3, 4번 오류 집중. 선지 소거 후 최종 판단 흔들림.",
    prescription: "① 오답 노트 선지 분석 주 2회\n② 30초 이상 고민 문항 체크 후 별도 복기",
    recheckNote: "처방 적용 2주차. 오답 패턴 미세 감소 확인 중.",
  },
  {
    code: "C007",
    name: "박서연",
    school: "명덕고",
    grade: "2",
    ldna: "패턴 학습 강. 새 지문 유형 노출 시 과도한 불안 반응.",
    phase: "evidence",
    urgency: "normal",
    lastSubmit: "2026-10-19",
    assignmentCount: 5,
    evidences: [
      { id: "e6", studentCode: "C007", kind: "submission", stance: "neutral", summary: "제출 기록 정상 (5건)", date: "2026-10-19", confidence: "보통" },
    ],
  },
];

// ── KPI 계산 ──────────────────────────────────────────────────────────────
function computeKpi(students: HelixStudent[]) {
  return {
    reviewNeeded: students.filter(s => s.phase === "evidence").length,
    pendingApproval: students.filter(s => s.prescriptionStatus === "draft").length,
    rechecking: students.filter(s => s.phase === "recheck").length,
    recoverySignal: students.filter(s => s.prescriptionStatus === "applied" && s.urgency === "low").length,
  };
}

// ── 서브 컴포넌트: KPI 띠 ────────────────────────────────────────────────
function KpiBand({ kpi }: { kpi: ReturnType<typeof computeKpi> }) {
  const items = [
    { label: "검토 필요", value: kpi.reviewNeeded,    color: "#e74c3c", bg: "#fdecea" },
    { label: "처방 승인", value: kpi.pendingApproval, color: "#f39c12", bg: "#fef9e7" },
    { label: "재검증 중", value: kpi.rechecking,      color: "#2980b9", bg: "#eaf4fb" },
    { label: "회복 신호", value: kpi.recoverySignal,  color: "#27ae60", bg: "#e8f8f5" },
  ];
  return (
    <div style={{ display:"flex", gap:10, marginBottom:18, flexWrap:"wrap" }}>
      {items.map(it => (
        <div key={it.label} style={{
          flex:"1 1 110px", minWidth:90,
          background:it.bg, border:`1.5px solid ${it.color}22`,
          borderRadius:8, padding:"10px 14px",
          display:"flex", flexDirection:"column", gap:2,
        }}>
          <span style={{ fontSize:22, fontWeight:700, color:it.color }}>{it.value}</span>
          <span style={{ fontSize:11, color:"#555" }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── 서브 컴포넌트: 루프 단계 배지 ─────────────────────────────────────────
function PhaseBadge({ phase, prescriptionStatus }: { phase: LoopPhase; prescriptionStatus?: PrescriptionStatus }) {
  const map: Record<LoopPhase, { label: string; color: string }> = {
    evidence:     { label: "근거 수집", color: "#8e44ad" },
    hypothesis:   { label: "가설",     color: "#2980b9" },
    prescription: { label: prescriptionStatus === "draft" ? "처방 승인 대기" : "처방 완료", color: prescriptionStatus === "draft" ? "#e74c3c" : "#f39c12" },
    recheck:      { label: "재검증",   color: "#27ae60" },
  };
  const { label, color } = map[phase];
  return (
    <span style={{
      display:"inline-block", padding:"2px 8px", borderRadius:12,
      background: color + "22", color, fontSize:11, fontWeight:600,
      border:`1px solid ${color}44`,
    }}>{label}</span>
  );
}

// ── 서브 컴포넌트: 신뢰도 배지 ───────────────────────────────────────────
function ConfidenceDot({ level }: { level: ConfidenceLevel }) {
  const colors: Record<ConfidenceLevel, string> = { 낮음:"#e74c3c", 보통:"#f39c12", 높음:"#27ae60" };
  return (
    <span style={{
      width:8, height:8, borderRadius:"50%", display:"inline-block",
      background: colors[level], marginRight:4, verticalAlign:"middle",
    }} title={`신뢰도: ${level}`} />
  );
}

// ── 서브 컴포넌트: Evidence 목록 ──────────────────────────────────────────
function EvidenceList({ evidences }: { evidences: Evidence[] }) {
  const kindLabel: Record<EvidenceKind, string> = {
    submission:   "제출",
    score:        "성적",
    assignment:   "과제",
    teacher_note: "교사 메모",
  };
  const stanceIcon: Record<EvidenceStance, string> = {
    supporting: "↑",
    against: "↓",
    neutral: "−",
  };
  const stanceColor: Record<EvidenceStance, string> = {
    supporting: "#27ae60",
    against: "#e74c3c",
    neutral: "#7f8c8d",
  };
  if (evidences.length === 0) return <p style={{ color:"#999", fontSize:12 }}>아직 근거가 없습니다.</p>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      {evidences.map(ev => (
        <div key={ev.id} style={{
          display:"flex", alignItems:"flex-start", gap:8,
          padding:"6px 8px", background:"#f9f9f9", borderRadius:6,
          borderLeft:`3px solid ${stanceColor[ev.stance]}`,
        }}>
          <span style={{ color:stanceColor[ev.stance], fontWeight:700, fontSize:13, minWidth:14 }}>{stanceIcon[ev.stance]}</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:12, color:"#333" }}>
              <ConfidenceDot level={ev.confidence} />
              <span style={{ fontWeight:600, color:"#555", marginRight:4 }}>[{kindLabel[ev.kind]}]</span>
              {ev.summary}
            </div>
            <div style={{ fontSize:10, color:"#aaa", marginTop:2 }}>{ev.date}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 서브 컴포넌트: 폐쇄 루프 흐름 띠 ─────────────────────────────────────
function LoopFlow({ phase }: { phase: LoopPhase }) {
  const steps: { id: LoopPhase; label: string; owner: string }[] = [
    { id: "evidence",     label: "근거",  owner: "Recorder" },
    { id: "hypothesis",   label: "가설",  owner: "HELIX"    },
    { id: "prescription", label: "처방",  owner: "Master"   },
    { id: "recheck",      label: "재검증", owner: "HELIX"   },
  ];
  const activeIdx = steps.findIndex(s => s.id === phase);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:0, margin:"8px 0 12px", flexWrap:"wrap" }}>
      {steps.map((step, i) => {
        const isActive = i === activeIdx;
        const isDone   = i < activeIdx;
        const color    = isDone ? "#27ae60" : isActive ? "#2980b9" : "#bdc3c7";
        return (
          <div key={step.id} style={{ display:"flex", alignItems:"center" }}>
            <div style={{ textAlign:"center" }}>
              <div style={{
                width:32, height:32, borderRadius:"50%",
                background: isDone ? "#e8f8f5" : isActive ? "#eaf4fb" : "#f5f5f5",
                border:`2px solid ${color}`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:12, fontWeight:700, color,
              }}>
                {isDone ? "✓" : i + 1}
              </div>
              <div style={{ fontSize:10, color, marginTop:2, whiteSpace:"nowrap" }}>{step.label}</div>
              <div style={{ fontSize:9, color:"#aaa", whiteSpace:"nowrap" }}>{step.owner}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ width:20, height:2, background: i < activeIdx ? "#27ae60" : "#e0e0e0", margin:"0 4px", marginBottom:14 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 서브 컴포넌트: 학생 카드 (목록 행) ───────────────────────────────────
function StudentRow({ st, selected, onSelect }: {
  st: HelixStudent;
  selected: boolean;
  onSelect: () => void;
}) {
  const urgencyColor = st.urgency === "high" ? "#e74c3c" : st.urgency === "normal" ? "#f39c12" : "#27ae60";
  return (
    <div
      onClick={onSelect}
      style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"10px 12px",
        background: selected ? "#eaf4fb" : "#fff",
        borderBottom:"1px solid #f0f0f0",
        cursor:"pointer",
        borderLeft: selected ? "3px solid #2980b9" : "3px solid transparent",
        transition:"background 0.15s",
      }}
    >
      <div style={{ width:6, height:6, borderRadius:"50%", background:urgencyColor, flexShrink:0 }} />
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:"#2c3e50" }}>
          {st.name}
          <span style={{ fontSize:11, color:"#888", fontWeight:400, marginLeft:6 }}>{st.school} {st.grade}학년</span>
        </div>
        <div style={{ fontSize:11, color:"#aaa", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {st.ldna}
        </div>
      </div>
      <div style={{ flexShrink:0, textAlign:"right" }}>
        <PhaseBadge phase={st.phase} prescriptionStatus={st.prescriptionStatus} />
        <div style={{ fontSize:10, color:"#aaa", marginTop:3 }}>근거 {st.evidences.length}건</div>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트: 학생 상세 작업대 ──────────────────────────────────────
function StudentWorkbench({ st, onApprove, onAddNote }: {
  st: HelixStudent;
  onApprove: () => void;
  onAddNote: (note: string) => void;
}) {
  const [noteInput, setNoteInput] = useState("");
  const [showNoteBox, setShowNoteBox] = useState(false);

  const supporting = st.evidences.filter(e => e.stance === "supporting").length;
  const against    = st.evidences.filter(e => e.stance === "against").length;
  const confidence: ConfidenceLevel =
    st.evidences.length >= 8 ? "높음" :
    st.evidences.length >= 5 ? "보통" : "낮음";

  return (
    <div style={{ padding:16, height:"100%", overflowY:"auto" }}>
      {/* 학생 헤더 */}
      <div style={{ marginBottom:12 }}>
        <div style={{ fontSize:17, fontWeight:700, color:"#2c3e50" }}>
          {st.name}
          <span style={{ fontSize:12, color:"#888", fontWeight:400, marginLeft:8 }}>{st.code} · {st.school} {st.grade}학년</span>
        </div>
        <div style={{ fontSize:11, color:"#888", marginTop:4, lineHeight:1.5 }}>
          <strong style={{ color:"#555" }}>L-DNA:</strong> {st.ldna}
        </div>
      </div>

      {/* 루프 흐름 */}
      <LoopFlow phase={st.phase} />

      {/* KPI 요약 */}
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        {[
          { label: "지지 근거", value: `${supporting}건`, color: "#27ae60" },
          { label: "반대 근거", value: `${against}건`,   color: "#e74c3c" },
          { label: "근거 신뢰도", value: confidence,     color: confidence === "높음" ? "#27ae60" : confidence === "보통" ? "#f39c12" : "#e74c3c" },
          ...(st.assignmentCount !== undefined ? [{ label: "과제 미제출", value: `${st.assignmentCount}건`, color: st.assignmentCount > 2 ? "#e74c3c" : "#555" }] : []),
        ].map(item => (
          <div key={item.label} style={{
            flex:"1 1 80px", minWidth:70,
            background:"#f9f9f9", borderRadius:6, padding:"6px 10px",
          }}>
            <div style={{ fontSize:13, fontWeight:700, color:item.color }}>{item.value}</div>
            <div style={{ fontSize:10, color:"#888" }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* 근거 목록 */}
      <div style={{ marginBottom:14 }}>
        <div style={{ fontSize:12, fontWeight:600, color:"#2c3e50", marginBottom:6 }}>
          📋 근거 목록
          <span style={{ fontSize:10, color:"#aaa", fontWeight:400, marginLeft:6 }}>Recorder 데이터 자동 수집</span>
        </div>
        <EvidenceList evidences={st.evidences} />
      </div>

      {/* 가설 */}
      {st.hypothesis && (
        <div style={{ marginBottom:14, padding:"10px 12px", background:"#f0f6ff", borderRadius:8, borderLeft:"3px solid #2980b9" }}>
          <div style={{ fontSize:11, fontWeight:600, color:"#2980b9", marginBottom:4 }}>🧠 가설 (HELIX)</div>
          <div style={{ fontSize:12, color:"#2c3e50", lineHeight:1.6 }}>{st.hypothesis}</div>
        </div>
      )}

      {/* 처방 */}
      {st.prescription && (
        <div style={{ marginBottom:14, padding:"10px 12px", background:"#fffbf0", borderRadius:8, borderLeft:"3px solid #f39c12" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
            <span style={{ fontSize:11, fontWeight:600, color:"#f39c12" }}>💊 처방 초안</span>
            {st.prescriptionStatus === "draft" && (
              <button
                onClick={onApprove}
                style={{
                  fontSize:11, padding:"3px 10px",
                  background:"#f39c12", color:"#fff", border:"none",
                  borderRadius:12, cursor:"pointer", fontWeight:600,
                }}
              >
                승인 → 과제 생성
              </button>
            )}
            {st.prescriptionStatus === "approved" && (
              <span style={{ fontSize:11, color:"#27ae60", fontWeight:600 }}>✓ 승인됨</span>
            )}
            {st.prescriptionStatus === "applied" && (
              <span style={{ fontSize:11, color:"#2980b9", fontWeight:600 }}>적용 중</span>
            )}
          </div>
          <div style={{ fontSize:12, color:"#2c3e50", whiteSpace:"pre-line", lineHeight:1.7 }}>{st.prescription}</div>
        </div>
      )}

      {/* 재검증 메모 */}
      {st.recheckNote && (
        <div style={{ marginBottom:14, padding:"10px 12px", background:"#eafaf1", borderRadius:8, borderLeft:"3px solid #27ae60" }}>
          <div style={{ fontSize:11, fontWeight:600, color:"#27ae60", marginBottom:4 }}>🔄 재검증 메모</div>
          <div style={{ fontSize:12, color:"#2c3e50" }}>{st.recheckNote}</div>
        </div>
      )}

      {/* 교사 메모 추가 */}
      <div style={{ marginTop:8 }}>
        {!showNoteBox ? (
          <button
            onClick={() => setShowNoteBox(true)}
            style={{
              fontSize:11, padding:"5px 12px",
              background:"#f5f5f5", border:"1px solid #ddd",
              borderRadius:6, cursor:"pointer", color:"#555",
            }}
          >
            + 교사 메모 추가 (근거로 등록)
          </button>
        ) : (
          <div>
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              placeholder="관찰 내용을 입력하면 근거로 등록됩니다..."
              rows={3}
              style={{
                width:"100%", fontSize:12, padding:"8px",
                border:"1px solid #ddd", borderRadius:6,
                resize:"vertical", boxSizing:"border-box",
              }}
            />
            <div style={{ display:"flex", gap:6, marginTop:6 }}>
              <button
                onClick={() => { if (noteInput.trim()) { onAddNote(noteInput.trim()); setNoteInput(""); setShowNoteBox(false); } }}
                style={{ fontSize:11, padding:"4px 12px", background:"#2980b9", color:"#fff", border:"none", borderRadius:6, cursor:"pointer" }}
              >
                근거 등록
              </button>
              <button
                onClick={() => setShowNoteBox(false)}
                style={{ fontSize:11, padding:"4px 10px", background:"#f5f5f5", border:"1px solid #ddd", borderRadius:6, cursor:"pointer", color:"#555" }}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 메인 패널 ─────────────────────────────────────────────────────────────
export default function HelixTodayPanel() {
  const [students, setStudents] = useState<HelixStudent[]>(DUMMY_STUDENTS);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [filterPhase, setFilterPhase] = useState<LoopPhase | "all">("all");
  const [isLoading, setIsLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);

  // Supabase에서 실제 학생 목록 가져오기 시도 (실패 시 더미 유지)
  useEffect(() => {
    const url  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key) return;

    setIsLoading(true);
    const sb = createClient(url, key);
    sb.from("students")
      .select("studentCode,name,school,grade")
      .eq("status", "active")
      .order("name")
      .then(({ data, error }) => {
        setIsLoading(false);
        if (error || !data || data.length === 0) return;
        // 실제 학생 목록으로 기반 구성 (Evidence는 아직 더미)
        const live: HelixStudent[] = data.map(r => ({
          code: r.studentCode ?? r.name,
          name: r.name,
          school: r.school ?? "",
          grade: r.grade ?? "",
          ldna: "학습 패턴 분석 데이터가 누적되면 자동 생성됩니다.",
          phase: "evidence" as LoopPhase,
          urgency: "normal" as const,
          evidences: [],
        }));
        setStudents(live);
        setLiveMode(true);
      });
  }, []);

  const kpi = computeKpi(students);
  const selectedStudent = students.find(s => s.code === selectedCode) ?? null;

  const filtered = filterPhase === "all"
    ? students
    : students.filter(s => s.phase === filterPhase);

  // 처방 승인 → 처방 상태 변경 (실제 구현: Supabase write + 과제 1건 생성)
  function handleApprove() {
    if (!selectedCode) return;
    setStudents(prev => prev.map(s =>
      s.code === selectedCode
        ? { ...s, prescriptionStatus: "approved" as PrescriptionStatus, phase: "recheck" as LoopPhase, urgency: "low" as const }
        : s
    ));
  }

  // 교사 메모 근거로 등록
  function handleAddNote(note: string) {
    if (!selectedCode) return;
    const newEvidence: Evidence = {
      id: `note_${Date.now()}`,
      studentCode: selectedCode,
      kind: "teacher_note",
      stance: "neutral",
      summary: note,
      date: new Date().toISOString().split("T")[0],
      confidence: "보통",
    };
    setStudents(prev => prev.map(s =>
      s.code === selectedCode
        ? { ...s, evidences: [...s.evidences, newEvidence] }
        : s
    ));
  }

  const phaseFilters: { id: LoopPhase | "all"; label: string }[] = [
    { id: "all",          label: "전체" },
    { id: "evidence",     label: "근거 수집" },
    { id: "hypothesis",   label: "가설" },
    { id: "prescription", label: "처방" },
    { id: "recheck",      label: "재검증" },
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0 }}>

      {/* ── 헤더 + 설명 띠 ── */}
      <div style={{ padding:"14px 16px 10px", borderBottom:"1px solid #eee" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div>
            <h2 style={{ margin:0, fontSize:16, fontWeight:700, color:"#2c3e50" }}>
              🧬 오늘의 판단
            </h2>
            <p style={{ margin:"2px 0 0", fontSize:11, color:"#888" }}>
              Recorder 기록 → 근거 → 가설 → 처방 → 재검증 흐름
              {liveMode && <span style={{ marginLeft:6, color:"#27ae60", fontWeight:600 }}>● 실시간</span>}
              {isLoading && <span style={{ marginLeft:6, color:"#aaa" }}>불러오는 중...</span>}
            </p>
          </div>
          {/* 흐름 소유자 범례 */}
          <div style={{ display:"flex", gap:10, fontSize:10, color:"#888" }}>
            {[["Recorder", "#7f8c8d"], ["HELIX", "#8e44ad"], ["Master", "#2980b9"]].map(([name, color]) => (
              <span key={name}>
                <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:color, marginRight:3 }} />
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* KPI 띠 */}
        <div style={{ marginTop:10 }}>
          <KpiBand kpi={kpi} />
        </div>

        {/* 필터 탭 */}
        <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
          {phaseFilters.map(f => (
            <button
              key={f.id}
              onClick={() => setFilterPhase(f.id)}
              style={{
                fontSize:11, padding:"3px 10px", borderRadius:12,
                border:`1px solid ${filterPhase === f.id ? "#2980b9" : "#ddd"}`,
                background: filterPhase === f.id ? "#2980b9" : "#fff",
                color: filterPhase === f.id ? "#fff" : "#555",
                cursor:"pointer",
              }}
            >
              {f.label}
              {f.id !== "all" && (
                <span style={{ marginLeft:4, opacity:0.8 }}>
                  {students.filter(s => s.phase === f.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── 본문: 목록 + 작업대 ── */}
      <div style={{ display:"flex", flex:1, minHeight:0, overflow:"hidden" }}>

        {/* 학생 목록 */}
        <div style={{
          width: selectedStudent ? "38%" : "100%",
          minWidth: selectedStudent ? 220 : undefined,
          borderRight: selectedStudent ? "1px solid #eee" : "none",
          overflowY:"auto",
          transition:"width 0.2s",
        }}>
          {filtered.length === 0 && (
            <div style={{ padding:24, textAlign:"center", color:"#aaa", fontSize:13 }}>
              해당 단계의 학생이 없습니다.
            </div>
          )}
          {filtered
            .sort((a, b) => {
              const urgOrder = { high:0, normal:1, low:2 };
              return (urgOrder[a.urgency] - urgOrder[b.urgency]);
            })
            .map(st => (
              <StudentRow
                key={st.code}
                st={st}
                selected={selectedCode === st.code}
                onSelect={() => setSelectedCode(prev => prev === st.code ? null : st.code)}
              />
            ))}
        </div>

        {/* 학생 작업대 */}
        {selectedStudent && (
          <div style={{ flex:1, minWidth:0, overflowY:"auto" }}>
            <StudentWorkbench
              st={selectedStudent}
              onApprove={handleApprove}
              onAddNote={handleAddNote}
            />
          </div>
        )}
      </div>

      {/* ── 하단 안내 ── */}
      {!liveMode && (
        <div style={{
          padding:"6px 14px", fontSize:10, color:"#aaa",
          borderTop:"1px solid #f0f0f0", background:"#fafafa",
        }}>
          ⚠ 현재 화면은 시연용 더미 데이터입니다. Supabase 연결 시 실제 학생 데이터로 전환됩니다.
        </div>
      )}
    </div>
  );
}

import { useEffect, useState, useMemo } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";
import {
  buildWWOrder, buildClinicOrder,
  saveWWOrder, saveClinicOrder,
  loadWWOrders, loadClinicOrders,
} from "../../lib/wwUtils";
import type { WWOrder, ClinicOrder, WWOrderType, ClinicOrderType } from "../../lib/wwUtils";
import { createStorageProvider } from "../../lib/storageFactory";
import type { ExamResult } from "../../core/types";
import {
  Send, FileText, ClipboardList, CheckCircle,
  Clock, Layers, BookOpen, Zap, Package,
  Brain, TrendingUp, Calendar
} from "lucide-react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

const WW_ORDER_LABELS: Record<WWOrderType, { label: string; icon: React.ReactNode; desc: string }> = {
  variation_mock: { label:"모의고사 변형 문제", icon:<Zap size={14}/>, desc:"수능 18~45번 변형 문제세트 제작" },
  workbook:       { label:"워크북",             icon:<BookOpen size={14}/>, desc:"시험 범위 워크북 제작 (1~3차)" },
  prelim_exam:    { label:"예비 시험지",         icon:<FileText size={14}/>, desc:"학교 내신 스타일 예상 시험지" },
  vocab_list:     { label:"어휘 목록",           icon:<ClipboardList size={14}/>, desc:"시험 범위 핵심 어휘 정리" },
  grammar_sheet:  { label:"어법 정리 시트",      icon:<FileText size={14}/>, desc:"출제 예상 어법 포인트 정리" },
  full_set:       { label:"전체 세트 (풀패키지)", icon:<Package size={14}/>, desc:"위 항목 전체 포함 풀세트" },
};

const CLINIC_ORDER_LABELS: Record<ClinicOrderType, { label: string; icon: React.ReactNode; desc: string }> = {
  deep_analysis:  { label:"심화 오답 분석",      icon:<Brain size={14}/>, desc:"문항별 오답 패턴 심층 분석" },
  prescription:   { label:"맞춤 처방",           icon:<TrendingUp size={14}/>, desc:"분석 기반 개인 맞춤 처방" },
  monthly_report: { label:"월간 상담 보고서",    icon:<Calendar size={14}/>, desc:"학부모 대상 월간 평가서 생성" },
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:     { bg:"#fef3c7", color:"#d97706", label:"대기" },
  in_progress: { bg:"#dbeafe", color:"#2563eb", label:"진행중" },
  done:        { bg:"#d1fae5", color:"#059669", label:"완료" },
};

export default function WWOrderPanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const storage = useMemo(() => createStorageProvider(), []);

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [results, setResults] = useState<ExamResult[]>([]);
  const [wwOrders, setWwOrders] = useState<WWOrder[]>([]);
  const [clinicOrders, setClinicOrders] = useState<ClinicOrder[]>([]);

  const [tab, setTab] = useState<"ww" | "clinic">("ww");
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedWWType, setSelectedWWType] = useState<WWOrderType>("variation_mock");
  const [selectedClinicType, setSelectedClinicType] = useState<ClinicOrderType>("deep_analysis");
  const [examDate, setExamDate] = useState("");
  const [examRange, setExamRange] = useState("");
  const [memo, setMemo] = useState("");
  const [notice, setNotice] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "pending" | "in_progress" | "done">("");

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    storage.listResults().then(setResults);
    setWwOrders(loadWWOrders());
    setClinicOrders(loadClinicOrders());
  }, []);

  function createWWOrder() {
    const student = roster.find(r => r.studentCode === selectedStudent);
    if (!student) { setNotice("학생을 선택해주세요."); return; }
    if (!examDate) { setNotice("시험일을 입력해주세요."); return; }
    const studentResults = results.filter(r => r.student.studentCode === selectedStudent);
    const order = buildWWOrder(student, examDate, examRange, studentResults, selectedWWType, memo);
    saveWWOrder(order);
    setWwOrders(loadWWOrders());
    setNotice(`✅ WW 작업 의뢰 생성 완료: ${WW_ORDER_LABELS[selectedWWType].label}`);
    setMemo(""); setTimeout(() => setNotice(""), 4000);
  }

  function createClinicOrder() {
    const student = roster.find(r => r.studentCode === selectedStudent);
    if (!student) { setNotice("학생을 선택해주세요."); return; }
    const studentResults = results.filter(r => r.student.studentCode === selectedStudent);
    if (studentResults.length === 0) { setNotice("모의고사 데이터가 없습니다."); return; }
    const order = buildClinicOrder(student, studentResults, selectedClinicType);
    saveClinicOrder(order);
    setClinicOrders(loadClinicOrders());
    setNotice(`✅ CLINIC-WW 의뢰 생성: ${CLINIC_ORDER_LABELS[selectedClinicType].label}`);
    setTimeout(() => setNotice(""), 4000);
  }

  function updateWWStatus(orderId: string, status: WWOrder["status"]) {
    const updated = wwOrders.map(o => o.orderId === orderId ? { ...o, status } : o);
    setWwOrders(updated);
    localStorage.setItem("l16.ww.orders", JSON.stringify(updated));
  }

  function updateClinicStatus(orderId: string, status: ClinicOrder["status"]) {
    const updated = clinicOrders.map(o => o.orderId === orderId ? { ...o, status } : o);
    setClinicOrders(updated);
    localStorage.setItem("l16.clinic.orders", JSON.stringify(updated));
  }

  function exportOrderJSON(order: WWOrder | ClinicOrder) {
    const json = JSON.stringify(order, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${order.orderId}.json`;
    a.click(); URL.revokeObjectURL(url);
  }

  const active = roster.filter(r => (r.studentStatus ?? "active") !== "withdrawn");
  const filteredWW = wwOrders.filter(o => !filterStatus || o.status === filterStatus);
  const filteredClinic = clinicOrders.filter(o => !filterStatus || o.status === filterStatus);

  return (
    <div className="card">
      <div style={{ marginBottom:20 }}>
        <h2 style={{ margin:"0 0 4px", color:"#1e40af", display:"flex", alignItems:"center", gap:8 }}>
          <Send size={20} color="#1e40af"/> WW / CLINIC-WW 작업 의뢰
        </h2>
        <p style={{ fontSize:12, color:"#64748b", margin:0 }}>
          학생 데이터를 기반으로 WW(교재 제작)와 CLINIC-WW(심화 분석)에 작업을 의뢰합니다.
        </p>
      </div>

      {notice && (
        <div style={{ padding:"10px 14px", borderRadius:8, marginBottom:14, fontWeight:600, fontSize:13,
          background: notice.startsWith("✅") ? "#f0fdf4" : "#fef3c7",
          border: `1px solid ${notice.startsWith("✅") ? "#86efac" : "#fde68a"}`,
          color: notice.startsWith("✅") ? "#166534" : "#92400e" }}>
          {notice}
        </div>
      )}

      {/* 탭 */}
      <div style={{ display:"flex", background:"#f1f5f9", borderRadius:8, padding:2, gap:2, marginBottom:20, width:"fit-content" }}>
        {([
          { key:"ww", label:"📦 WW 교재 제작" },
          { key:"clinic", label:"🧠 CLINIC-WW 분석" },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ padding:"6px 16px", borderRadius:6, border:"none", fontSize:13, fontWeight:600, cursor:"pointer",
              background: tab===t.key ? "#1e40af" : "transparent",
              color: tab===t.key ? "#fff" : "#64748b" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── WW 교재 제작 의뢰 ── */}
      {tab === "ww" && (
        <div>
          {/* 의뢰 생성 폼 */}
          <div style={{ border:"1.5px solid #bfdbfe", borderRadius:12, padding:18, marginBottom:20, background:"#eff6ff" }}>
            <h3 style={{ fontSize:14, fontWeight:700, color:"#1e40af", marginBottom:14 }}>
              새 작업 의뢰
            </h3>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>학생 선택</label>
                <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #93c5fd", fontSize:13 }}>
                  <option value="">-- 학생 선택 --</option>
                  {active.map(r => (
                    <option key={r.studentCode} value={r.studentCode}>
                      {r.name} ({r.school} {r.grade}학년)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>의뢰 유형</label>
                <select value={selectedWWType} onChange={e => setSelectedWWType(e.target.value as WWOrderType)}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #93c5fd", fontSize:13 }}>
                  {Object.entries(WW_ORDER_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>영어 시험일</label>
                <input type="date" value={examDate} onChange={e => setExamDate(e.target.value)}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #93c5fd", fontSize:13 }} />
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>시험 범위</label>
                <input value={examRange} onChange={e => setExamRange(e.target.value)}
                  placeholder="예) 교과서 1~3과, 부교재 Unit 1-5"
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #93c5fd", fontSize:13 }} />
              </div>
            </div>
            {/* 선택된 유형 설명 */}
            <div style={{ padding:"8px 12px", background:"#dbeafe", borderRadius:8, marginBottom:10, fontSize:12, color:"#1e40af" }}>
              <strong>{WW_ORDER_LABELS[selectedWWType].label}</strong> — {WW_ORDER_LABELS[selectedWWType].desc}
            </div>
            <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>메모 (선택)</label>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} rows={2}
              placeholder="추가 요청사항을 입력하세요"
              style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1px solid #bfdbfe",
                fontSize:13, resize:"none" as const, boxSizing:"border-box" as const, marginBottom:12 }} />
            <button onClick={createWWOrder}
              style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px",
                borderRadius:8, border:"none", background:"#1e40af", color:"#fff",
                fontWeight:700, fontSize:14, cursor:"pointer" }}>
              <Send size={14}/> WW 작업 의뢰 생성
            </button>
          </div>

          {/* 의뢰 목록 */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <h3 style={{ fontSize:14, fontWeight:700, color:"#475569", margin:0 }}>의뢰 이력</h3>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)}
              style={{ padding:"5px 10px", borderRadius:8, border:"1px solid #e2e8f0", fontSize:12 }}>
              <option value="">전체</option>
              <option value="pending">대기</option>
              <option value="in_progress">진행중</option>
              <option value="done">완료</option>
            </select>
          </div>
          {filteredWW.length === 0 ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"20px 0" }}>의뢰 내역이 없습니다.</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {filteredWW.map(order => {
                const ss = STATUS_STYLE[order.status];
                const info = WW_ORDER_LABELS[order.orderType];
                return (
                  <div key={order.orderId} style={{ border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
                    <div style={{ padding:"10px 14px", background:"#f8fafc",
                      display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span style={{ display:"flex", alignItems:"center", gap:4, fontSize:12,
                          background:"#dbeafe", color:"#1e40af", padding:"2px 8px", borderRadius:6, fontWeight:600 }}>
                          {info.icon} {info.label}
                        </span>
                        <span style={{ fontWeight:700, fontSize:13 }}>{order.studentName}</span>
                        <span style={{ fontSize:11, color:"#94a3b8" }}>
                          {order.school} {order.grade}학년 | D-{
                            order.examDate ? Math.max(0, Math.ceil((new Date(order.examDate).getTime()-Date.now())/86400000)) : "-"
                          }
                        </span>
                        <span style={{ fontSize:11, padding:"2px 7px", borderRadius:6, fontWeight:600,
                          background:ss.bg, color:ss.color }}>{ss.label}</span>
                      </div>
                      <div style={{ display:"flex", gap:6 }}>
                        {(["pending","in_progress","done"] as const).map(s => (
                          <button key={s} onClick={() => updateWWStatus(order.orderId, s)}
                            disabled={order.status===s}
                            style={{ padding:"3px 8px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer",
                              border:"1px solid #e2e8f0",
                              background: order.status===s ? STATUS_STYLE[s].bg : "#fff",
                              color: order.status===s ? STATUS_STYLE[s].color : "#64748b" }}>
                            {STATUS_STYLE[s].label}
                          </button>
                        ))}
                        <button onClick={() => exportOrderJSON(order)}
                          style={{ padding:"3px 8px", borderRadius:6, fontSize:11, cursor:"pointer",
                            border:"1px solid #e2e8f0", background:"#fff", color:"#475569" }}>
                          JSON
                        </button>
                      </div>
                    </div>
                    <div style={{ padding:"8px 14px", fontSize:12, color:"#64748b",
                      display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px,1fr))", gap:"4px 16px" }}>
                      <div><span style={{color:"#94a3b8"}}>시험일: </span>{order.examDate || "-"}</div>
                      <div><span style={{color:"#94a3b8"}}>범위: </span>{order.examRange || "-"}</div>
                      <div><span style={{color:"#94a3b8"}}>현재점수: </span>{order.currentScore}점</div>
                      <div><span style={{color:"#94a3b8"}}>목표점수: </span>{order.targetScore}점</div>
                      <div style={{ gridColumn:"1/-1" }}>
                        <span style={{color:"#94a3b8"}}>취약 유형: </span>
                        {order.weakPoints.length > 0
                          ? order.weakPoints.join(", ")
                          : "데이터 없음"}
                      </div>
                      {order.memo && <div style={{ gridColumn:"1/-1" }}>
                        <span style={{color:"#94a3b8"}}>메모: </span>{order.memo}
                      </div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CLINIC-WW 분석 의뢰 ── */}
      {tab === "clinic" && (
        <div>
          <div style={{ border:"1.5px solid #d1fae5", borderRadius:12, padding:18, marginBottom:20, background:"#f0fdf4" }}>
            <h3 style={{ fontSize:14, fontWeight:700, color:"#059669", marginBottom:14 }}>새 분석 의뢰</h3>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
              <div>
                <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>학생 선택</label>
                <select value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #6ee7b7", fontSize:13 }}>
                  <option value="">-- 학생 선택 --</option>
                  {active.map(r => (
                    <option key={r.studentCode} value={r.studentCode}>
                      {r.name} ({r.school} {r.grade}학년)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize:12, fontWeight:600, display:"block", marginBottom:5 }}>분석 유형</label>
                <select value={selectedClinicType} onChange={e => setSelectedClinicType(e.target.value as ClinicOrderType)}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:8, border:"1.5px solid #6ee7b7", fontSize:13 }}>
                  {Object.entries(CLINIC_ORDER_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ padding:"8px 12px", background:"#d1fae5", borderRadius:8, marginBottom:12, fontSize:12, color:"#065f46" }}>
              <strong>{CLINIC_ORDER_LABELS[selectedClinicType].label}</strong> — {CLINIC_ORDER_LABELS[selectedClinicType].desc}
            </div>
            <button onClick={createClinicOrder}
              style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 20px",
                borderRadius:8, border:"none", background:"#059669", color:"#fff",
                fontWeight:700, fontSize:14, cursor:"pointer" }}>
              <Brain size={14}/> CLINIC-WW 분석 의뢰
            </button>
          </div>

          {filteredClinic.length === 0 ? (
            <p style={{ color:"#94a3b8", textAlign:"center", padding:"20px 0" }}>분석 의뢰 내역이 없습니다.</p>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {filteredClinic.map(order => {
                const ss = STATUS_STYLE[order.status];
                const info = CLINIC_ORDER_LABELS[order.orderType];
                return (
                  <div key={order.orderId} style={{ border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden" }}>
                    <div style={{ padding:"10px 14px", background:"#f8fafc",
                      display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span style={{ display:"flex", alignItems:"center", gap:4, fontSize:12,
                          background:"#d1fae5", color:"#059669", padding:"2px 8px", borderRadius:6, fontWeight:600 }}>
                          {info.icon} {info.label}
                        </span>
                        <span style={{ fontWeight:700, fontSize:13 }}>{order.studentName}</span>
                        <span style={{ fontSize:11, color:"#94a3b8" }}>
                          분석 {order.results.length}회 모의고사 기반
                        </span>
                        <span style={{ fontSize:11, padding:"2px 7px", borderRadius:6, fontWeight:600,
                          background:ss.bg, color:ss.color }}>{ss.label}</span>
                      </div>
                      <div style={{ display:"flex", gap:6 }}>
                        {(["pending","in_progress","done"] as const).map(s => (
                          <button key={s} onClick={() => updateClinicStatus(order.orderId, s)}
                            disabled={order.status===s}
                            style={{ padding:"3px 8px", borderRadius:6, fontSize:11, fontWeight:600, cursor:"pointer",
                              border:"1px solid #e2e8f0",
                              background: order.status===s ? STATUS_STYLE[s].bg : "#fff",
                              color: order.status===s ? STATUS_STYLE[s].color : "#64748b" }}>
                            {STATUS_STYLE[s].label}
                          </button>
                        ))}
                        <button onClick={() => exportOrderJSON(order)}
                          style={{ padding:"3px 8px", borderRadius:6, fontSize:11, cursor:"pointer",
                            border:"1px solid #e2e8f0", background:"#fff", color:"#475569" }}>
                          JSON
                        </button>
                      </div>
                    </div>
                    {order.wrongPatterns.length > 0 && (
                      <div style={{ padding:"8px 14px", fontSize:12, color:"#64748b" }}>
                        <span style={{color:"#94a3b8"}}>취약 유형: </span>
                        {order.wrongPatterns.slice(0,4).map(p => (
                          <span key={p.questionType} style={{ marginRight:8 }}>
                            {p.questionType}({p.count}회, 자신감 {p.avgConfidence}%)
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

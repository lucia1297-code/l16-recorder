import { useEffect, useMemo, useState } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const GH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const JH = { ...GH, "Content-Type": "application/json" };

// ── 카테고리 ─────────────────────────────────────────────────
const CATEGORIES = [
  { label: "상담", color: "#7c3aed", bg: "#ede9fe" },
  { label: "보충수업", color: "#0891b2", bg: "#e0f2fe" },
  { label: "과제마감", color: "#dc2626", bg: "#fee2e2" },
  { label: "학부모연락", color: "#d97706", bg: "#fef3c7" },
  { label: "행사", color: "#059669", bg: "#d1fae5" },
  { label: "개인일정", color: "#64748b", bg: "#f1f5f9" },
  { label: "기타", color: "#374151", bg: "#f9fafb" },
];

const STATUS_META: Record<string, { bg: string; color: string }> = {
  예정:   { bg: "#dbeafe", color: "#1e40af" },
  진행중: { bg: "#fef3c7", color: "#713f12" },
  완료:   { bg: "#d1fae5", color: "#065f46" },
  취소:   { bg: "#fee2e2", color: "#991b1b" },
};

const PRIORITY_META: Record<string, { color: string }> = {
  높음: { color: "#dc2626" },
  보통: { color: "#64748b" },
  낮음: { color: "#94a3b8" },
};

interface ScheduleEvent {
  id: string;
  student_code: string | null;
  student_name: string | null;
  event_date: string;
  end_date: string | null;
  category: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  color: string;
  created_at: string;
}

const TODAY = new Date().toISOString().slice(0, 10);

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 한국 공휴일
const HOLIDAYS: Record<string, string> = {
  "2026-01-01":"새해","2026-01-29":"설날","2026-03-01":"삼일절",
  "2026-05-05":"어린이날","2026-05-25":"부처님오신날","2026-06-06":"현충일",
  "2026-08-15":"광복절","2026-09-25":"추석","2026-10-03":"개천절",
  "2026-10-09":"한글날","2026-12-25":"성탄절",
  "2025-01-01":"새해","2025-01-29":"설날","2025-03-01":"삼일절",
  "2025-05-05":"어린이날","2025-05-06":"부처님오신날","2025-06-06":"현충일",
  "2025-08-15":"광복절","2025-10-06":"추석","2025-10-03":"개천절",
  "2025-10-09":"한글날","2025-12-25":"성탄절",
};

export default function SchedulePanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  // 뷰
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());

  // 필터
  const [filterStudent, setFilterStudent] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // 폼
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fStudent, setFStudent] = useState("");
  const [fDate, setFDate] = useState(TODAY);
  const [fEndDate, setFEndDate] = useState("");
  const [fCat, setFCat] = useState("상담");
  const [fTitle, setFTitle] = useState("");
  const [fDesc, setFDesc] = useState("");
  const [fPriority, setFPriority] = useState("보통");
  const [fStatus, setFStatus] = useState("예정");

  // 선택된 날짜 (달력 클릭)
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    rosterStore.listRoster().then(setRoster);
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/student_schedules?order=event_date.asc,created_at.desc`,
        { headers: GH }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      setEvents(await res.json());
    } catch (e) {
      setNotice("로드 실패: " + (e as Error).message);
    }
    setLoading(false);
  }

  async function save() {
    if (!fTitle.trim()) { setNotice("제목을 입력하세요."); return; }
    if (!fDate) { setNotice("날짜를 선택하세요."); return; }
    setSaving(true); setNotice("");
    const catMeta = CATEGORIES.find(c => c.label === fCat);
    const student = roster.find(r => r.studentCode === fStudent);
    const body = {
      student_code: fStudent || null,
      student_name: student?.name || null,
      event_date: fDate,
      end_date: fEndDate || null,
      category: fCat,
      title: fTitle,
      description: fDesc,
      priority: fPriority,
      status: fStatus,
      color: catMeta?.color ?? "#0f766e",
    };
    try {
      if (editId) {
        const res = await fetch(`${SB_URL}/rest/v1/student_schedules?id=eq.${editId}`,
          { method: "PATCH", headers: JH, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`${res.status}`);
      } else {
        const res = await fetch(`${SB_URL}/rest/v1/student_schedules`,
          { method: "POST", headers: { ...JH, Prefer: "return=minimal" }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`${res.status}`);
      }
      setNotice("✅ 저장 완료");
      resetForm();
      await load();
    } catch (e) {
      setNotice("저장 실패: " + (e as Error).message);
    }
    setSaving(false);
    setTimeout(() => setNotice(""), 3000);
  }

  async function del(id: string) {
    if (!confirm("이 일정을 삭제할까요?")) return;
    const res = await fetch(`${SB_URL}/rest/v1/student_schedules?id=eq.${id}`,
      { method: "DELETE", headers: JH });
    if (res.ok) { await load(); setNotice("삭제 완료"); setTimeout(() => setNotice(""), 2000); }
  }

  function startEdit(ev: ScheduleEvent) {
    setEditId(ev.id);
    setFStudent(ev.student_code || "");
    setFDate(ev.event_date);
    setFEndDate(ev.end_date || "");
    setFCat(ev.category);
    setFTitle(ev.title);
    setFDesc(ev.description || "");
    setFPriority(ev.priority);
    setFStatus(ev.status);
    setShowForm(true);
  }

  function resetForm() {
    setEditId(null); setShowForm(false);
    setFStudent(""); setFDate(TODAY); setFEndDate("");
    setFCat("상담"); setFTitle(""); setFDesc("");
    setFPriority("보통"); setFStatus("예정");
  }

  function openNewOnDate(date: string) {
    resetForm();
    setFDate(date);
    setSelectedDate(date);
    setShowForm(true);
  }

  const active = roster.filter(r => (r.studentStatus ?? "active") !== "withdrawn");

  const filtered = events.filter(e =>
    (!filterStudent || e.student_code === filterStudent) &&
    (!filterCat    || e.category === filterCat) &&
    (!filterStatus || e.status === filterStatus)
  );

  // 달력용 날짜별 이벤트 맵 — 기간 일정은 시작~종료 모든 날짜에 표시
  const eventByDate = useMemo(() => {
    const m: Record<string, ScheduleEvent[]> = {};
    filtered.forEach(e => {
      const start = new Date(e.event_date);
      const end   = e.end_date ? new Date(e.end_date) : start;
      const cur   = new Date(start);
      while (cur <= end) {
        const k = cur.toISOString().slice(0, 10);
        if (!m[k]) m[k] = [];
        // 같은 이벤트 중복 방지
        if (!m[k].find(x => x.id === e.id)) m[k].push(e);
        cur.setDate(cur.getDate() + 1);
      }
    });
    return m;
  }, [filtered]);

  // ── 달력 렌더 ────────────────────────────────────────────
  function CalendarView() {
    const first = new Date(calYear, calMonth, 1);
    const last  = new Date(calYear, calMonth + 1, 0);
    const cells: { date: Date; other: boolean }[] = [];
    for (let i = first.getDay() - 1; i >= 0; i--)
      cells.push({ date: new Date(calYear, calMonth, -i), other: true });
    for (let i = 1; i <= last.getDate(); i++)
      cells.push({ date: new Date(calYear, calMonth, i), other: false });
    while (cells.length % 7 !== 0)
      cells.push({ date: new Date(calYear, calMonth + 1, cells.length - last.getDate() - first.getDay() + 1), other: true });

    return (
      <div>
        {/* 달력 헤더 */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <button onClick={() => { let m=calMonth-1,y=calYear; if(m<0){m=11;y--;} setCalMonth(m);setCalYear(y); }}
            style={{ padding:"6px 12px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff",cursor:"pointer",fontSize:14 }}>◀</button>
          <span style={{ fontWeight:700,fontSize:16 }}>{calYear}년 {calMonth+1}월</span>
          <button onClick={() => { let m=calMonth+1,y=calYear; if(m>11){m=0;y++;} setCalMonth(m);setCalYear(y); }}
            style={{ padding:"6px 12px",border:"1px solid #e2e8f0",borderRadius:8,background:"#fff",cursor:"pointer",fontSize:14 }}>▶</button>
        </div>
        {/* 요일 헤더 */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3 }}>
          {["일","월","화","수","목","금","토"].map((d,i) => (
            <div key={d} style={{ textAlign:"center",fontSize:11,fontWeight:700,padding:"4px 0",
              color:i===0?"#dc2626":i===6?"#2563eb":"#64748b" }}>{d}</div>
          ))}
        </div>
        {/* 날짜 셀 */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3 }}>
          {cells.map(({ date, other }, i) => {
            const key = toKey(date.getFullYear(), date.getMonth(), date.getDate());
            const holiday = HOLIDAYS[key];
            const isSun = date.getDay() === 0;
            const isSat = date.getDay() === 6;
            const isToday = key === TODAY;
            const dayEvents = eventByDate[key] || [];
            const isSelected = selectedDate === key;
            return (
              <div key={i} onClick={() => { setSelectedDate(key === selectedDate ? null : key); }}
                onDoubleClick={() => openNewOnDate(key)}
                style={{ minHeight:70,borderRadius:8,padding:"5px 5px 4px",cursor:"pointer",
                  border:`1.5px solid ${isSelected?"#7c3aed":isToday?"#0f766e":"#e2e8f0"}`,
                  background: isSelected?"#faf5ff":isToday?"#f0fdf4":other?"#fafafa":"#fff",
                  opacity: other ? 0.5 : 1 }}>
                <div style={{ fontSize:12,fontWeight:isToday?800:500,marginBottom:2,
                  color: holiday||isSun?"#dc2626":isSat?"#2563eb":other?"#94a3b8":"#1e293b" }}>
                  {date.getDate()}
                </div>
                {holiday && <div style={{ fontSize:9,color:"#dc2626",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{holiday}</div>}
                <div style={{ display:"flex",flexDirection:"column",gap:1 }}>
                  {dayEvents.map(ev => {
                    const cat = CATEGORIES.find(c => c.label === ev.category);
                    const isMultiDay = ev.end_date && ev.end_date !== ev.event_date;
                    const isStart = key === ev.event_date;
                    const isEnd   = key === ev.end_date;
                    const borderR = isMultiDay && !isEnd   ? 0 : 3;
                    const borderL = isMultiDay && !isStart ? 0 : 3;
                    const prefix  = isStart && isMultiDay ? "▶ " : isEnd ? "■ " : isMultiDay ? "── " : "";
                    return (
                      <div key={ev.id} title={`${ev.student_name||"공통"} · ${ev.title}`}
                        style={{ fontSize:9,padding:"1px 4px",fontWeight:600,
                          background:cat?.bg??"#f1f5f9",color:cat?.color??"#374151",
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                          borderRadius:`${borderL}px ${borderR}px ${borderR}px ${borderL}px`,
                          marginLeft: !isStart&&isMultiDay ? -2 : 0,
                          marginRight: !isEnd&&isMultiDay ? -2 : 0 }}>
                        {prefix}{ev.student_name ? `${ev.student_name[0]} ` : ""}{isStart||!isMultiDay?ev.title:""}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* 선택 날짜 이벤트 상세 */}
        {selectedDate && (
          <div style={{ marginTop:16,border:"1.5px solid #7c3aed",borderRadius:12,padding:16,background:"#faf5ff" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
              <span style={{ fontWeight:700,fontSize:14,color:"#4c1d95" }}>📅 {selectedDate}</span>
              <button onClick={() => openNewOnDate(selectedDate)}
                style={{ padding:"5px 12px",borderRadius:8,border:"none",background:"#7c3aed",
                  color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer" }}>+ 추가</button>
            </div>
            {(eventByDate[selectedDate] || []).length === 0
              ? <p style={{ color:"#94a3b8",fontSize:13 }}>이 날 일정이 없습니다. 더블클릭하거나 + 추가 버튼을 누르세요.</p>
              : (eventByDate[selectedDate] || []).map(ev => <EventCard key={ev.id} ev={ev} />)
            }
          </div>
        )}
      </div>
    );
  }

  // ── 이벤트 카드 ────────────────────────────────────────────
  function EventCard({ ev }: { ev: ScheduleEvent }) {
    const cat = CATEGORIES.find(c => c.label === ev.category);
    const sm  = STATUS_META[ev.status] ?? { bg:"#f1f5f9",color:"#374151" };
    const pm  = PRIORITY_META[ev.priority] ?? { color:"#64748b" };
    return (
      <div style={{ border:"1px solid #e2e8f0",borderRadius:10,padding:"12px 14px",marginBottom:8,
        background:"#fff",borderLeft:`4px solid ${cat?.color ?? "#0f766e"}` }}>
        <div style={{ display:"flex",alignItems:"flex-start",gap:8,flexWrap:"wrap" }}>
          <div style={{ flex:1 }}>
            <div style={{ display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginBottom:4 }}>
              <span style={{ fontWeight:700,fontSize:14,color:"#1e293b" }}>{ev.title}</span>
              <span style={{ fontSize:11,padding:"1px 6px",borderRadius:4,fontWeight:600,
                background:cat?.bg??"#f1f5f9",color:cat?.color??"#374151" }}>{ev.category}</span>
              <span style={{ fontSize:11,padding:"1px 6px",borderRadius:4,fontWeight:600,
                background:sm.bg,color:sm.color }}>{ev.status}</span>
              <span style={{ fontSize:11,fontWeight:700,color:pm.color }}>{"●".repeat(ev.priority==="높음"?3:ev.priority==="보통"?2:1)}</span>
            </div>
            {ev.student_name && (
              <div style={{ fontSize:12,color:"#64748b",marginBottom:3 }}>👤 {ev.student_name}</div>
            )}
            <div style={{ fontSize:11,color:"#94a3b8" }}>
              {ev.event_date}{ev.end_date ? ` ~ ${ev.end_date}` : ""}
            </div>
            {ev.description && (
              <div style={{ fontSize:12,color:"#64748b",marginTop:5,lineHeight:1.6 }}>{ev.description}</div>
            )}
          </div>
          <div style={{ display:"flex",gap:5,flexShrink:0 }}>
            <button onClick={() => { startEdit(ev); setView("list"); }}
              style={{ padding:"3px 9px",borderRadius:6,border:"1px solid #e2e8f0",
                background:"#fff",fontSize:11,cursor:"pointer",fontWeight:600 }}>수정</button>
            <button onClick={() => del(ev.id)}
              style={{ padding:"3px 9px",borderRadius:6,border:"1px solid #fecaca",
                background:"#fef2f2",color:"#dc2626",fontSize:11,cursor:"pointer",fontWeight:600 }}>삭제</button>
          </div>
        </div>
      </div>
    );
  }

  // ── 목록 뷰 ────────────────────────────────────────────────
  function ListView() {
    // 날짜별 그룹
    const groups: Record<string, ScheduleEvent[]> = {};
    filtered.forEach(e => {
      if (!groups[e.event_date]) groups[e.event_date] = [];
      groups[e.event_date].push(e);
    });
    const sortedDates = Object.keys(groups).sort();
    return (
      <div>
        {sortedDates.length === 0
          ? <div style={{ textAlign:"center",padding:"40px 0",color:"#94a3b8" }}>
              <p style={{ fontSize:32,marginBottom:8 }}>📭</p>
              <p>일정이 없습니다.</p>
            </div>
          : sortedDates.map(date => (
            <div key={date} style={{ marginBottom:16 }}>
              <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:8 }}>
                <div style={{ fontSize:13,fontWeight:700,color:HOLIDAYS[date]?"#dc2626":"#374151" }}>
                  📅 {date}
                  {HOLIDAYS[date] && <span style={{ marginLeft:6,fontSize:11,color:"#dc2626" }}>({HOLIDAYS[date]})</span>}
                  {date === TODAY && <span style={{ marginLeft:6,fontSize:11,color:"#0f766e",fontWeight:800 }}>오늘</span>}
                </div>
                <div style={{ flex:1,height:1,background:"#e2e8f0" }}/>
                <span style={{ fontSize:11,color:"#94a3b8" }}>{groups[date].length}건</span>
              </div>
              {groups[date].map(ev => <EventCard key={ev.id} ev={ev} />)}
            </div>
          ))}
      </div>
    );
  }

  // ── 폼 ──────────────────────────────────────────────────────
  function Form() {
    return (
      <div style={{ border:"2px solid #0f766e",borderRadius:12,padding:18,marginBottom:20,background:"#f0fdf4" }}>
        <h3 style={{ margin:"0 0 14px",fontSize:14,color:"#0f766e" }}>
          {editId ? "✏️ 일정 수정" : "➕ 새 일정 추가"}
        </h3>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
          {/* 학생 */}
          <div>
            <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:5 }}>학생 (선택)</label>
            <select value={fStudent} onChange={e => setFStudent(e.target.value)}
              style={{ width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #6ee7b7",fontSize:13,fontFamily:"inherit" }}>
              <option value="">공통 일정 (학생 없음)</option>
              {active.map(r => <option key={r.studentCode} value={r.studentCode}>{r.name} ({r.school} {r.grade}학년)</option>)}
            </select>
          </div>
          {/* 카테고리 */}
          <div>
            <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:5 }}>카테고리</label>
            <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
              {CATEGORIES.map(c => (
                <button key={c.label} onClick={() => setFCat(c.label)}
                  style={{ padding:"5px 10px",borderRadius:7,border:"none",cursor:"pointer",fontSize:11,fontWeight:700,
                    background:fCat===c.label?c.bg:"#f1f5f9",color:fCat===c.label?c.color:"#64748b",
                    outline:fCat===c.label?`2px solid ${c.color}`:"none" }}>{c.label}</button>
              ))}
            </div>
          </div>
          {/* 날짜 */}
          <div>
            <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:5 }}>시작일</label>
            <input type="date" value={fDate} onChange={e => setFDate(e.target.value)}
              style={{ width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #6ee7b7",fontSize:13,fontFamily:"inherit",boxSizing:"border-box" as const }} />
          </div>
          <div>
            <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:5 }}>종료일 (선택)</label>
            <input type="date" value={fEndDate} onChange={e => setFEndDate(e.target.value)}
              style={{ width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #6ee7b7",fontSize:13,fontFamily:"inherit",boxSizing:"border-box" as const }} />
          </div>
          {/* 제목 */}
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:5 }}>제목</label>
            <input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder="일정 제목"
              style={{ width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #6ee7b7",fontSize:13,fontFamily:"inherit",boxSizing:"border-box" as const }} />
          </div>
          {/* 우선순위 + 상태 */}
          <div>
            <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:5 }}>우선순위</label>
            <div style={{ display:"flex",gap:6 }}>
              {["높음","보통","낮음"].map(p => (
                <button key={p} onClick={() => setFPriority(p)}
                  style={{ flex:1,padding:"6px",borderRadius:7,border:`2px solid ${fPriority===p?PRIORITY_META[p].color:"#e2e8f0"}`,
                    background:"#fff",color:fPriority===p?PRIORITY_META[p].color:"#64748b",
                    fontWeight:700,fontSize:12,cursor:"pointer" }}>{p}</button>
              ))}
            </div>
          </div>
          <div>
            <label style={{ fontSize:12,fontWeight:700,color:"#374151",display:"block",marginBottom:5 }}>상태</label>
            <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
              {["예정","진행중","완료","취소"].map(s => {
                const sm = STATUS_META[s];
                return (
                  <button key={s} onClick={() => setFStatus(s)}
                    style={{ flex:1,minWidth:50,padding:"6px",borderRadius:7,border:"none",cursor:"pointer",
                      fontWeight:700,fontSize:12,
                      background:fStatus===s?sm.bg:"#f1f5f9",color:fStatus===s?sm.color:"#64748b",
                      outline:fStatus===s?`2px solid ${sm.color}`:"none" }}>{s}</button>
                );
              })}
            </div>
          </div>
          {/* 설명 — 직접 입력 */}
          <div style={{ gridColumn:"1/-1" }}>
            <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:6,flexWrap:"wrap" }}>
              <label style={{ fontSize:12,fontWeight:700,color:"#374151" }}>내용 / 메모</label>
              <span style={{ fontSize:11,color:"#94a3b8" }}>빠른 입력:</span>
              {["상담완료","전화연락","자료전달","수업내용:","숙제:","특이사항:","다음수업:","준비물:"].map(t => (
                <button key={t} type="button"
                  onClick={() => setFDesc(prev => prev ? prev + "\n" + t + " " : t + " ")}
                  style={{ padding:"2px 8px",borderRadius:5,border:"1px solid #6ee7b7",
                    background:"#f0fdf4",color:"#065f46",fontSize:11,cursor:"pointer",fontWeight:600 }}>
                  {t}
                </button>
              ))}
            </div>
            <textarea value={fDesc} onChange={e => setFDesc(e.target.value)} rows={5}
              placeholder={"내용을 자유롭게 입력하세요.\n\n예)\n• 상담내용: 수능 대비 전략 논의\n• 학부모 요청사항: 수학 병행 요청\n• 다음수업: 빈칸추론 집중"}
              style={{ width:"100%",padding:"10px 12px",borderRadius:8,border:"1.5px solid #6ee7b7",
                fontSize:13,fontFamily:"inherit",resize:"vertical" as const,
                boxSizing:"border-box" as const,lineHeight:1.7 }} />
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4 }}>
              <span style={{ fontSize:11,color:"#94a3b8" }}>{fDesc.length}자</span>
              {fDesc && <button type="button" onClick={() => setFDesc("")}
                style={{ fontSize:11,color:"#dc2626",background:"none",border:"none",cursor:"pointer" }}>지우기</button>}
            </div>
          </div>
        </div>
        <div style={{ display:"flex",gap:8,marginTop:14 }}>
          <button onClick={save} disabled={saving}
            style={{ flex:1,padding:12,borderRadius:9,border:"none",background:"#0f766e",
              color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer" }}>
            {saving?"저장 중…":editId?"수정 저장":"저장"}
          </button>
          <button onClick={resetForm}
            style={{ flex:1,padding:12,borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",fontSize:13,cursor:"pointer" }}>
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* 헤더 */}
      <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap" }}>
        <h2 style={{ margin:0,fontSize:16,color:"#0f766e" }}>📆 학생 일정 관리</h2>
        <div style={{ display:"flex",gap:5,marginLeft:"auto" }}>
          <button onClick={() => setView("calendar")}
            style={{ padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              background:view==="calendar"?"#0f766e":"#f1f5f9",color:view==="calendar"?"#fff":"#374151" }}>
            📅 달력
          </button>
          <button onClick={() => setView("list")}
            style={{ padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
              background:view==="list"?"#0f766e":"#f1f5f9",color:view==="list"?"#fff":"#374151" }}>
            📋 목록
          </button>
          <button onClick={() => { resetForm(); setShowForm(true); }}
            style={{ padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,
              background:"#0f766e",color:"#fff" }}>+ 새 일정</button>
          <button onClick={load} title="새로고침"
            style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",cursor:"pointer" }}>🔄</button>
        </div>
      </div>

      {notice && (
        <p style={{ fontWeight:600,fontSize:13,marginBottom:12,
          color:notice.startsWith("✅")?"#059669":"#dc2626" }}>{notice}</p>
      )}

      {/* 필터 */}
      <div style={{ display:"flex",gap:8,marginBottom:14,flexWrap:"wrap" }}>
        <select value={filterStudent} onChange={e => setFilterStudent(e.target.value)}
          style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:12,fontFamily:"inherit" }}>
          <option value="">전체 학생</option>
          <option value="__none__">공통 일정</option>
          {active.map(r => <option key={r.studentCode} value={r.studentCode}>{r.name}</option>)}
        </select>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
          style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:12,fontFamily:"inherit" }}>
          <option value="">전체 카테고리</option>
          {CATEGORIES.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:12,fontFamily:"inherit" }}>
          <option value="">전체 상태</option>
          {["예정","진행중","완료","취소"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize:12,color:"#64748b",alignSelf:"center",marginLeft:"auto" }}>{filtered.length}건</span>
      </div>

      {showForm && Form()}

      {loading
        ? <p style={{ color:"#94a3b8",fontSize:13 }}>로딩 중…</p>
        : view === "calendar" ? <CalendarView /> : <ListView />
      }

      <p style={{ fontSize:11,color:"#94a3b8",marginTop:16 }}>
        💡 달력에서 날짜를 더블클릭하면 해당 날짜로 바로 일정을 추가할 수 있습니다.
      </p>
    </div>
  );
}

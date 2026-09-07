import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, Trash2, Save, Bell, BellOff, Tag, Calendar,
  FileText, ChevronLeft, ChevronRight, Download, Star, Lightbulb,
  BookOpen, User, Briefcase, AlertCircle, X
} from "lucide-react";

// ── 타입 ──────────────────────────────────────────────────────
interface Memo {
  id: string;
  title: string;
  body: string;
  tag: string;
  alarm: string;
  createdAt: string;
  updatedAt: string;
  _alarmFired?: boolean;
}

// ── 상수 ──────────────────────────────────────────────────────
const TAG_META: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  아이디어: { color: "#92400e", bg: "#fef3c7", icon: <Lightbulb size={12} /> },
  업무:     { color: "#1e40af", bg: "#dbeafe", icon: <Briefcase size={12} /> },
  수업:     { color: "#065f46", bg: "#d1fae5", icon: <BookOpen size={12} /> },
  학생:     { color: "#4c1d95", bg: "#ede9fe", icon: <User size={12} /> },
  중요:     { color: "#991b1b", bg: "#fee2e2", icon: <AlertCircle size={12} /> },
  개인:     { color: "#831843", bg: "#fce7f3", icon: <Star size={12} /> },
};

const HOLIDAYS: Record<string, string> = {
  "2026-01-01":"새해","2026-01-28":"설날연휴","2026-01-29":"설날","2026-01-30":"설날연휴",
  "2026-03-01":"삼일절","2026-05-05":"어린이날","2026-05-25":"부처님오신날",
  "2026-06-06":"현충일","2026-08-15":"광복절",
  "2026-09-24":"추석연휴","2026-09-25":"추석","2026-09-26":"추석연휴",
  "2026-10-03":"개천절","2026-10-09":"한글날","2026-12-25":"성탄절",
  "2025-01-01":"새해","2025-01-28":"설날연휴","2025-01-29":"설날","2025-01-30":"설날연휴",
  "2025-03-01":"삼일절","2025-05-05":"어린이날","2025-05-06":"부처님오신날",
  "2025-06-06":"현충일","2025-08-15":"광복절",
  "2025-10-05":"추석연휴","2025-10-06":"추석","2025-10-07":"추석연휴",
  "2025-10-03":"개천절","2025-10-09":"한글날","2025-12-25":"성탄절",
};

// ── 유틸 ──────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function toKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function fmtDatetime(iso: string) {
  if (!iso) return "";
  return iso.slice(0, 16);
}

// ── 메인 컴포넌트 ────────────────────────────────────────────
export default function MemoPanel() {
  const [memos, setMemos] = useState<Memo[]>(() =>
    JSON.parse(localStorage.getItem("l16_memos") || "[]")
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar" | "alarm">("list");
  const [filterTag, setFilterTag] = useState("");
  const [search, setSearch] = useState("");
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [alarmToast, setAlarmToast] = useState<string | null>(null);

  // 편집 상태
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tag, setTag] = useState("");
  const [alarm, setAlarm] = useState("");
  const [dirty, setDirty] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 저장
  const saveMemos = (next: Memo[]) => {
    setMemos(next);
    localStorage.setItem("l16_memos", JSON.stringify(next));
  };

  // 알림 체크
  useEffect(() => {
    const check = () => {
      const now = new Date();
      setMemos(prev => {
        let changed = false;
        const next = prev.map(m => {
          if (!m.alarm || m._alarmFired) return m;
          if (Math.abs(new Date(m.alarm).getTime() - now.getTime()) < 60000) {
            setAlarmToast(m.title || "(제목 없음)");
            changed = true;
            return { ...m, _alarmFired: true };
          }
          return m;
        });
        if (changed) { localStorage.setItem("l16_memos", JSON.stringify(next)); return next; }
        return prev;
      });
    };
    const t = setInterval(check, 30000);
    check();
    return () => clearInterval(t);
  }, []);

  // Ctrl+S
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (currentId) handleSave(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [currentId, title, body, tag, alarm]);

  // 필터된 메모
  const filtered = useMemo(() => {
    let list = [...memos];
    if (search) { const q = search.toLowerCase(); list = list.filter(m => (m.title+m.body+m.tag).toLowerCase().includes(q)); }
    if (filterTag) list = list.filter(m => m.tag === filterTag);
    return list.sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [memos, search, filterTag]);

  const tagCounts = useMemo(() => {
    const c: Record<string,number> = {};
    memos.forEach(m => { if(m.tag) c[m.tag]=(c[m.tag]||0)+1; });
    return c;
  }, [memos]);

  const pendingAlarms = memos.filter(m => m.alarm && !m._alarmFired && new Date(m.alarm) > new Date()).length;

  function selectMemo(id: string) {
    if (dirty && !confirm("저장하지 않은 내용이 있습니다. 이동할까요?")) return;
    const m = memos.find(x => x.id === id);
    if (!m) return;
    setCurrentId(id); setTitle(m.title); setBody(m.body); setTag(m.tag);
    setAlarm(m.alarm ? fmtDatetime(m.alarm) : ""); setDirty(false);
  }

  function handleNew() {
    if (dirty && !confirm("저장하지 않은 내용이 있습니다. 계속할까요?")) return;
    const m: Memo = { id: uid(), title:"", body:"", tag:"", alarm:"", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    saveMemos([m, ...memos]);
    setCurrentId(m.id); setTitle(""); setBody(""); setTag(""); setAlarm(""); setDirty(false);
    setView("list");
    setTimeout(() => document.getElementById("memo-title-input")?.focus(), 50);
  }

  function handleSave() {
    if (!currentId) return;
    const next = memos.map(m => m.id === currentId
      ? { ...m, title: title||"(제목 없음)", body, tag, alarm: alarm ? new Date(alarm).toISOString() : "", updatedAt: new Date().toISOString() }
      : m);
    saveMemos(next); setDirty(false);
  }

  function handleDelete() {
    if (!currentId) return;
    const m = memos.find(x => x.id === currentId);
    if (!confirm(`"${m?.title||"(제목 없음)"}" 메모를 삭제할까요?`)) return;
    saveMemos(memos.filter(x => x.id !== currentId));
    setCurrentId(null); setTitle(""); setBody(""); setTag(""); setAlarm(""); setDirty(false);
  }

  function exportAll() {
    const txt = memos.map(m =>
      `# ${m.title||"(제목 없음)"}\n태그: ${m.tag||"없음"} | 알림: ${m.alarm?fmtDate(m.alarm):"없음"} | ${fmtDate(m.updatedAt)}\n\n${m.body||""}\n\n${"─".repeat(40)}\n`
    ).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], {type:"text/plain;charset=utf-8"}));
    a.download = `L16_메모_${toKey(new Date())}.txt`;
    a.click();
  }

  // ── 달력 렌더 ────────────────────────────────────────────
  function renderCalendar() {
    const first = new Date(calYear, calMonth, 1);
    const last = new Date(calYear, calMonth+1, 0);
    const today = toKey(new Date());
    const memoByDate: Record<string,number> = {};
    memos.forEach(m => { if(m.updatedAt) { const k=m.updatedAt.slice(0,10); memoByDate[k]=(memoByDate[k]||0)+1; } });
    const alarmByDate: Record<string,number> = {};
    memos.forEach(m => { if(m.alarm) { const k=m.alarm.slice(0,10); alarmByDate[k]=(alarmByDate[k]||0)+1; } });

    const cells: { date: Date; other: boolean }[] = [];
    for (let i=first.getDay()-1; i>=0; i--) cells.push({ date: new Date(calYear,calMonth,-i), other:true });
    for (let i=1; i<=last.getDate(); i++) cells.push({ date: new Date(calYear,calMonth,i), other:false });
    while (cells.length%7!==0) cells.push({ date: new Date(calYear,calMonth+1,cells.length-last.getDate()-first.getDay()+1), other:true });

    return (
      <div style={{ padding:"20px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <button onClick={() => { let m=calMonth-1,y=calYear; if(m<0){m=11;y--;} setCalMonth(m);setCalYear(y); }}
            style={{ background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 12px",cursor:"pointer" }}>
            <ChevronLeft size={16}/>
          </button>
          <span style={{ fontWeight:700,fontSize:16 }}>{calYear}년 {calMonth+1}월</span>
          <button onClick={() => { let m=calMonth+1,y=calYear; if(m>11){m=0;y++;} setCalMonth(m);setCalYear(y); }}
            style={{ background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 12px",cursor:"pointer" }}>
            <ChevronRight size={16}/>
          </button>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3 }}>
          {["일","월","화","수","목","금","토"].map((d,i) => (
            <div key={d} style={{ textAlign:"center",fontSize:11,fontWeight:700,color:i===0?"#dc2626":i===6?"#2563eb":"#64748b",padding:"4px 0" }}>{d}</div>
          ))}
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3 }}>
          {cells.map(({date,other},i) => {
            const key = toKey(date);
            const holiday = HOLIDAYS[key];
            const isSun = date.getDay()===0;
            const isSat = date.getDay()===6;
            const isToday = key===today;
            const mCnt = memoByDate[key]||0;
            const aCnt = alarmByDate[key]||0;
            return (
              <div key={i} onClick={() => { setView("list"); setSearch(""); setFilterTag(""); }}
                style={{ minHeight:60,borderRadius:8,padding:5,border:`1px solid ${isToday?"#0f766e":"#e2e8f0"}`,
                  background:isToday?"#f0fdf4":other?"#fafafa":"#fff",cursor:"pointer",
                  opacity:other?0.45:1 }}>
                <div style={{ fontSize:12,fontWeight:isToday?700:500,
                  color:holiday||isSun?"#dc2626":isSat?"#2563eb":other?"#94a3b8":"#1e293b" }}>
                  {date.getDate()}
                </div>
                {holiday && <div style={{ fontSize:9,color:"#dc2626",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{holiday}</div>}
                <div style={{ display:"flex",gap:2,marginTop:2,flexWrap:"wrap" }}>
                  {mCnt>0 && Array.from({length:Math.min(mCnt,4)}).map((_,j) => (
                    <div key={j} style={{ width:6,height:6,borderRadius:"50%",background:"#0f766e" }}/>
                  ))}
                  {aCnt>0 && Array.from({length:Math.min(aCnt,2)}).map((_,j) => (
                    <div key={j} style={{ width:6,height:6,borderRadius:"50%",background:"#dc2626" }}/>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop:12,display:"flex",gap:16,fontSize:11,color:"#64748b" }}>
          <span><span style={{ display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#0f766e",marginRight:4 }}/>메모 있음</span>
          <span><span style={{ display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#dc2626",marginRight:4 }}/>알림 있음</span>
          <span style={{ color:"#dc2626",fontWeight:600 }}>빨간 날짜: 공휴일/일요일</span>
          <span style={{ color:"#2563eb",fontWeight:600 }}>파란 날짜: 토요일</span>
        </div>
      </div>
    );
  }

  // ── UI ───────────────────────────────────────────────────
  return (
    <div className="card" style={{ padding:0, overflow:"hidden", height:"calc(100vh - 120px)", display:"flex", flexDirection:"column" }}>
      {/* 알림 토스트 */}
      {alarmToast && (
        <div style={{ position:"fixed",top:20,right:20,zIndex:9999,background:"#dc2626",color:"#fff",
          borderRadius:12,padding:"14px 18px",boxShadow:"0 4px 20px rgba(220,38,38,.4)",
          display:"flex",alignItems:"center",gap:10,maxWidth:320 }}>
          <Bell size={18}/>
          <div>
            <div style={{ fontWeight:700,fontSize:14 }}>알림: {alarmToast}</div>
            <div style={{ fontSize:11,opacity:.8,marginTop:2 }}>메모장을 확인하세요</div>
          </div>
          <button onClick={() => setAlarmToast(null)} style={{ background:"none",border:"none",color:"#fff",cursor:"pointer",marginLeft:8 }}>
            <X size={16}/>
          </button>
        </div>
      )}

      {/* 헤더 */}
      <div style={{ display:"flex",alignItems:"center",gap:10,padding:"14px 18px",
        borderBottom:"1px solid #e2e8f0",background:"#f8fafc",flexWrap:"wrap" }}>
        <FileText size={18} color="#0f766e"/>
        <span style={{ fontWeight:700,fontSize:15,color:"#0f766e" }}>메모장</span>
        <div style={{ flex:1,minWidth:140,position:"relative" }}>
          <Search size={13} style={{ position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:"#94a3b8",pointerEvents:"none" }}/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="검색…"
            style={{ width:"100%",padding:"6px 10px 6px 30px",borderRadius:8,border:"1px solid #e2e8f0",
              fontSize:13,fontFamily:"inherit",background:"#fff",boxSizing:"border-box" as const }}/>
        </div>
        <button onClick={() => setView("list")}
          style={{ padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
            background:view==="list"?"#0f766e":"#f1f5f9",color:view==="list"?"#fff":"#374151" }}>
          <FileText size={13} style={{ verticalAlign:"middle",marginRight:4 }}/>목록
        </button>
        <button onClick={() => setView("calendar")}
          style={{ padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
            background:view==="calendar"?"#0f766e":"#f1f5f9",color:view==="calendar"?"#fff":"#374151" }}>
          <Calendar size={13} style={{ verticalAlign:"middle",marginRight:4 }}/>달력
        </button>
        <button onClick={() => setView("alarm")}
          style={{ padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",fontSize:12,fontWeight:600,
            background:view==="alarm"?"#dc2626":"#f1f5f9",color:view==="alarm"?"#fff":"#374151",position:"relative" }}>
          <Bell size={13} style={{ verticalAlign:"middle",marginRight:4 }}/>알림
          {pendingAlarms>0 && <span style={{ position:"absolute",top:-4,right:-4,background:"#dc2626",color:"#fff",
            fontSize:9,fontWeight:700,borderRadius:10,padding:"1px 4px",border:"2px solid #fff" }}>{pendingAlarms}</span>}
        </button>
        <button onClick={handleNew}
          style={{ padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,
            background:"#0f766e",color:"#fff",display:"flex",alignItems:"center",gap:5 }}>
          <Plus size={14}/>새 메모
        </button>
        <button onClick={exportAll}
          style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #e2e8f0",cursor:"pointer",
            background:"#fff",color:"#374151" }} title="전체 내보내기">
          <Download size={14}/>
        </button>
      </div>

      {/* 달력 뷰 */}
      {view === "calendar" && (
        <div style={{ flex:1,overflowY:"auto" }}>{renderCalendar()}</div>
      )}

      {/* 알림 뷰 */}
      {view === "alarm" && (
        <div style={{ flex:1,overflowY:"auto",padding:20 }}>
          <h3 style={{ fontSize:14,fontWeight:700,marginBottom:14,color:"#dc2626" }}>🔔 알림 목록</h3>
          {memos.filter(m => m.alarm).length === 0
            ? <p style={{ color:"#94a3b8",fontSize:13 }}>설정된 알림이 없습니다.</p>
            : memos.filter(m => m.alarm).sort((a,b) => a.alarm.localeCompare(b.alarm)).map(m => {
              const past = new Date(m.alarm) < new Date();
              return (
                <div key={m.id} onClick={() => { setView("list"); selectMemo(m.id); }}
                  style={{ border:`1px solid ${past?"#fca5a5":"#e2e8f0"}`,borderRadius:10,padding:"12px 14px",
                    marginBottom:8,display:"flex",alignItems:"center",gap:10,cursor:"pointer",
                    background:past?"#fef2f2":"#fff" }}>
                  {past ? <Bell size={18} color="#dc2626"/> : <Bell size={18} color="#0f766e"/>}
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700,fontSize:13 }}>{m.title||"(제목 없음)"}</div>
                    <div style={{ fontSize:11,color:past?"#dc2626":"#64748b",marginTop:2 }}>
                      {past?"⚠️ 지남: ":"예정: "}{fmtDate(m.alarm)}
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); saveMemos(memos.map(x => x.id===m.id?{...x,alarm:""}:x)); }}
                    style={{ background:"none",border:"none",cursor:"pointer",color:"#94a3b8" }}>
                    <BellOff size={15}/>
                  </button>
                </div>
              );
            })}
        </div>
      )}

      {/* 목록 + 편집 뷰 */}
      {view === "list" && (
        <div style={{ flex:1,display:"flex",overflow:"hidden" }}>

          {/* 왼쪽 사이드 — 태그 + 목록 */}
          <div style={{ display:"flex",flexDirection:"column",width:280,minWidth:280,borderRight:"1px solid #e2e8f0",overflow:"hidden" }}>
            {/* 태그 필터 */}
            <div style={{ padding:"10px 12px 8px",borderBottom:"1px solid #e2e8f0",background:"#fafafa" }}>
              <div style={{ display:"flex",gap:5,flexWrap:"wrap" }}>
                <button onClick={() => setFilterTag("")}
                  style={{ padding:"3px 10px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,
                    background:filterTag===""?"#0f766e":"#f1f5f9",color:filterTag===""?"#fff":"#374151" }}>전체</button>
                {Object.entries(TAG_META).map(([t,meta]) => (
                  <button key={t} onClick={() => setFilterTag(filterTag===t?"":t)}
                    style={{ padding:"3px 8px",borderRadius:6,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,
                      background:filterTag===t?meta.bg:meta.bg+"88",color:meta.color,
                      outline:filterTag===t?`2px solid ${meta.color}`:"none" }}>
                    {t}{tagCounts[t]?` (${tagCounts[t]})`:""}</button>
                ))}
              </div>
            </div>
            {/* 메모 목록 */}
            <div style={{ flex:1,overflowY:"auto" }}>
              <div style={{ padding:"8px 12px 4px",fontSize:11,color:"#64748b",fontWeight:600 }}>
                {filterTag?`#${filterTag} `:""}{filtered.length}개
              </div>
              {filtered.length===0
                ? <div style={{ padding:"30px 16px",textAlign:"center",color:"#94a3b8",fontSize:13 }}>
                    메모가 없습니다.<br/>
                    <button onClick={handleNew} style={{ marginTop:10,padding:"6px 14px",borderRadius:8,border:"none",
                      background:"#0f766e",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600 }}>＋ 새 메모</button>
                  </div>
                : filtered.map(m => {
                  const meta = TAG_META[m.tag];
                  return (
                    <div key={m.id} onClick={() => selectMemo(m.id)}
                      style={{ padding:"10px 12px",borderBottom:"1px solid #f1f5f9",cursor:"pointer",
                        background:currentId===m.id?"#f0fdf4":"#fff",
                        borderLeft:currentId===m.id?"3px solid #0f766e":"3px solid transparent" }}>
                      <div style={{ fontWeight:600,fontSize:13,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                        {m.title||"(제목 없음)"}
                      </div>
                      <div style={{ fontSize:11,color:"#94a3b8",margin:"3px 0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                        {(m.body||"").slice(0,50)}
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:5,flexWrap:"wrap" }}>
                        {meta && <span style={{ fontSize:10,padding:"1px 6px",borderRadius:4,background:meta.bg,color:meta.color,fontWeight:600,display:"flex",alignItems:"center",gap:2 }}>
                          {meta.icon}{m.tag}</span>}
                        {m.alarm && <span style={{ fontSize:10,background:"#fef2f2",color:"#dc2626",padding:"1px 5px",borderRadius:4,display:"flex",alignItems:"center",gap:2 }}>
                          <Bell size={9}/>{fmtDate(m.alarm)}</span>}
                        <span style={{ fontSize:10,color:"#cbd5e1",marginLeft:"auto" }}>{fmtDate(m.updatedAt)}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* 오른쪽 — 편집기 */}
          <div style={{ flex:1,display:"flex",flexDirection:"column",overflow:"hidden" }}>
            {!currentId
              ? <div style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#94a3b8",gap:10 }}>
                  <FileText size={40} color="#e2e8f0"/>
                  <p style={{ fontSize:14 }}>메모를 선택하거나 새로 만드세요</p>
                  <button onClick={handleNew} style={{ padding:"8px 18px",borderRadius:9,border:"none",
                    background:"#0f766e",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,
                    display:"flex",alignItems:"center",gap:6 }}>
                    <Plus size={15}/>새 메모 만들기
                  </button>
                </div>
              : <>
                  {/* 편집 툴바 */}
                  <div style={{ padding:"10px 14px",borderBottom:"1px solid #e2e8f0",background:"#fafafa",
                    display:"flex",alignItems:"center",gap:8,flexWrap:"wrap" }}>
                    <input id="memo-title-input" value={title} onChange={e => {setTitle(e.target.value);setDirty(true);}}
                      placeholder="제목 입력…"
                      style={{ flex:1,minWidth:120,fontSize:16,fontWeight:700,border:"none",background:"transparent",
                        fontFamily:"inherit",color:"#1e293b",outline:"none" }}/>
                    <select value={tag} onChange={e => {setTag(e.target.value);setDirty(true);}}
                      style={{ padding:"5px 8px",borderRadius:7,border:"1px solid #e2e8f0",fontSize:12,
                        fontFamily:"inherit",background:"#fff",cursor:"pointer" }}>
                      <option value="">태그 없음</option>
                      {Object.keys(TAG_META).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div style={{ display:"flex",alignItems:"center",gap:4 }}>
                      <Bell size={13} color="#64748b"/>
                      <input type="datetime-local" value={alarm} onChange={e => {setAlarm(e.target.value);setDirty(true);}}
                        style={{ padding:"4px 8px",borderRadius:7,border:"1px solid #e2e8f0",fontSize:12,fontFamily:"inherit" }}/>
                    </div>
                    <button onClick={handleSave}
                      style={{ padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,
                        background:"#0f766e",color:"#fff",display:"flex",alignItems:"center",gap:5 }}>
                      <Save size={13}/>저장{dirty?" *":""}
                    </button>
                    <button onClick={handleDelete}
                      style={{ padding:"6px 10px",borderRadius:8,border:"1px solid #fecaca",cursor:"pointer",
                        background:"#fef2f2",color:"#dc2626" }}>
                      <Trash2 size={14}/>
                    </button>
                  </div>
                  {/* 태그 뱃지 표시 */}
                  {tag && TAG_META[tag] && (
                    <div style={{ padding:"6px 14px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:6 }}>
                      <Tag size={11} color={TAG_META[tag].color}/>
                      <span style={{ fontSize:11,padding:"2px 8px",borderRadius:5,fontWeight:600,
                        background:TAG_META[tag].bg,color:TAG_META[tag].color }}>{tag}</span>
                      {alarm && <span style={{ fontSize:11,color:"#dc2626",display:"flex",alignItems:"center",gap:4 }}>
                        <Bell size={11}/> 알림: {fmtDate(new Date(alarm).toISOString())}
                      </span>}
                    </div>
                  )}
                  <textarea ref={bodyRef} value={body}
                    onChange={e => {setBody(e.target.value);setDirty(true);}}
                    placeholder={"메모 내용을 입력하세요…\n\n# 제목\n## 소제목\n- 목록 항목\n\nCtrl+S 로 빠르게 저장"}
                    style={{ flex:1,padding:"16px 18px",border:"none",resize:"none",fontSize:14,
                      lineHeight:1.8,fontFamily:"inherit",color:"#1e293b",outline:"none",background:"#fff" }}/>
                </>}
          </div>
        </div>
      )}
    </div>
  );
}

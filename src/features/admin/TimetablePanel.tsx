import { useEffect, useMemo, useRef, useState } from "react";
import { createRosterStore } from "../../lib/rosterStoreFactory";
import type { RosterEntry } from "../../core/roster";

const SB_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const SB_H = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

// ── 상수 ─────────────────────────────────────────────────────
const DAYS   = ["일", "월", "화", "수", "목", "금", "토"] as const;
const DAY_COLORS = {
  "일": { bg:"#fef2f2", border:"#fca5a5", head:"#ef4444", light:"#fee2e2" },
  "월": { bg:"#f0f9ff", border:"#7dd3fc", head:"#0891b2", light:"#e0f2fe" },
  "화": { bg:"#f0fdf4", border:"#86efac", head:"#059669", light:"#dcfce7" },
  "수": { bg:"#fefce8", border:"#fde047", head:"#ca8a04", light:"#fef9c3" },
  "목": { bg:"#fdf4ff", border:"#d8b4fe", head:"#9333ea", light:"#f3e8ff" },
  "금": { bg:"#fff7ed", border:"#fdba74", head:"#ea580c", light:"#ffedd5" },
  "토": { bg:"#f8fafc", border:"#94a3b8", head:"#475569", light:"#e2e8f0" },
} as const;

// 6:00 ~ 24:00, 30분 단위
const SLOTS: string[] = [];
for (let h = 6; h < 24; h++) {
  SLOTS.push(`${String(h).padStart(2,"0")}:00`);
  SLOTS.push(`${String(h).padStart(2,"0")}:30`);
}
SLOTS.push("24:00");

// 슬롯 인덱스 → 표시 라벨
function slotLabel(slot: string) {
  const [h] = slot.split(":").map(Number);
  if (h === 12) return "오후 12:00";
  if (h === 0 || h === 24) return "자정";
  if (h < 12) return `오전 ${slot}`;
  return `오후 ${h - 12}:${slot.split(":")[1]}`;
}

// ── 타입 ─────────────────────────────────────────────────────
interface TimetableBlock {
  id: string;
  day: typeof DAYS[number];
  startSlot: string;   // "HH:MM"
  endSlot: string;
  studentCodes: string[];
  title: string;
  color: string;
  note: string;
}

const BLOCK_COLORS = [
  { label:"파랑",  value:"#0891b2" },
  { label:"초록",  value:"#059669" },
  { label:"보라",  value:"#7c3aed" },
  { label:"주황",  value:"#ea580c" },
  { label:"빨강",  value:"#dc2626" },
  { label:"회색",  value:"#475569" },
];

const EMPTY_BLOCK: Omit<TimetableBlock,"id"> = {
  day: "월", startSlot: "14:00", endSlot: "16:00",
  studentCodes: [], title: "", color: "#0891b2", note: "",
};

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==="x"?r:(r&3|8)).toString(16);
  });
}

// 슬롯 → 분
function toMin(slot: string) {
  const [h,m] = slot.split(":").map(Number);
  return (h === 24 ? 24*60 : h*60+m) - 6*60;
}
const TOTAL_MIN = (24-6)*60; // 1080분

export default function TimetablePanel() {
  const rosterStore = useMemo(() => createRosterStore(), []);
  const [roster, setRoster]   = useState<RosterEntry[]>([]);
  const [blocks, setBlocks]   = useState<TimetableBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice]   = useState("");
  const [saving, setSaving]   = useState(false);

  // 모달
  const [modal, setModal] = useState<null | "add" | "edit">(null);
  const [form,  setForm]  = useState<Omit<TimetableBlock,"id">>(EMPTY_BLOCK);
  const [editId, setEditId] = useState<string|null>(null);

  // 학생 검색
  const [stuSearch, setStuSearch] = useState("");

  useEffect(() => {
    rosterStore.listRoster().then(r =>
      setRoster(r.filter(s => (s.studentStatus ?? "active") !== "withdrawn"))
    );
    loadBlocks();
  }, []);

  async function loadBlocks() {
    setLoading(true);
    try {
      const res = await fetch(
        `${SB_URL}/rest/v1/timetable_blocks?order=day,start_slot`,
        { headers: SB_H }
      ).catch(() => null);
      if (!res || !res.ok) {
        // 테이블 없으면 localStorage 폴백
        const saved = localStorage.getItem("l16.timetable");
        if (saved) setBlocks(JSON.parse(saved));
        return;
      }
      const data = await res.json().catch(() => []);
      const mapped: TimetableBlock[] = (Array.isArray(data) ? data : []).map((r: any) => ({
        id: r.id, day: r.day, startSlot: r.start_slot, endSlot: r.end_slot,
        studentCodes: JSON.parse(r.student_codes || "[]"),
        title: r.title, color: r.color, note: r.note ?? "",
      }));
      setBlocks(mapped);
      localStorage.setItem("l16.timetable", JSON.stringify(mapped));
    } catch(e) {
      const saved = localStorage.getItem("l16.timetable");
      if (saved) { try { setBlocks(JSON.parse(saved)); } catch {} }
    } finally {
      setLoading(false);
    }
  }

  async function saveBlock(block: TimetableBlock) {
    setSaving(true);
    const row = {
      id: block.id, day: block.day,
      start_slot: block.startSlot, end_slot: block.endSlot,
      student_codes: JSON.stringify(block.studentCodes),
      title: block.title, color: block.color, note: block.note,
    };
    try {
      const res = await fetch(`${SB_URL}/rest/v1/timetable_blocks`, {
        method: "POST",
        headers: { ...SB_H, Prefer: "return=minimal,resolution=merge-duplicates" },
        body: JSON.stringify(row),
      }).catch(() => null);
      if (!res || !res.ok) throw new Error("Supabase 저장 실패");
    } catch {
      // localStorage 폴백
    }
    const next = editId
      ? blocks.map(b => b.id === editId ? block : b)
      : [...blocks, block];
    setBlocks(next);
    localStorage.setItem("l16.timetable", JSON.stringify(next));
    setSaving(false);
  }

  async function deleteBlock(id: string) {
    if (!confirm("이 수업을 삭제하시겠습니까?")) return;
    try {
      await fetch(`${SB_URL}/rest/v1/timetable_blocks?id=eq.${id}`,
        { method:"DELETE", headers: SB_H }).catch(()=>{});
    } catch {}
    const next = blocks.filter(b => b.id !== id);
    setBlocks(next);
    localStorage.setItem("l16.timetable", JSON.stringify(next));
  }

  function openAdd(day?: typeof DAYS[number]) {
    setForm({ ...EMPTY_BLOCK, day: day ?? "월" });
    setEditId(null);
    setStuSearch("");
    setModal("add");
  }

  function openEdit(block: TimetableBlock) {
    setForm({ day:block.day, startSlot:block.startSlot, endSlot:block.endSlot,
      studentCodes:[...block.studentCodes], title:block.title, color:block.color, note:block.note });
    setEditId(block.id);
    setStuSearch("");
    setModal("edit");
  }

  async function handleSave() {
    if (!form.title.trim()) { setNotice("수업 이름을 입력해주세요."); return; }
    if (form.startSlot >= form.endSlot) { setNotice("종료 시간이 시작 시간보다 뒤여야 합니다."); return; }
    const block: TimetableBlock = {
      id: editId ?? uuid(),
      ...form,
    };
    await saveBlock(block);
    setModal(null);
    setNotice(editId ? "수업이 수정됐습니다." : "수업이 추가됐습니다.");
    setTimeout(() => setNotice(""), 3000);
  }

  function toggleStudent(code: string) {
    setForm(f => ({
      ...f,
      studentCodes: f.studentCodes.includes(code)
        ? f.studentCodes.filter(c => c !== code)
        : [...f.studentCodes, code],
    }));
  }

  // ── 그리드 계산 ──────────────────────────────────────────
  const gridH = 1200; // px (전체 높이)
  const blocksByDay = useMemo(() => {
    const m: Record<string, TimetableBlock[]> = {};
    DAYS.forEach(d => m[d] = []);
    blocks.forEach(b => { if (m[b.day]) m[b.day].push(b); });
    return m;
  }, [blocks]);

  const filteredRoster = roster.filter(r =>
    !stuSearch || r.name.includes(stuSearch) || r.school.includes(stuSearch)
  );

  return (
    <div className="card" style={{ padding:0, overflow:"hidden" }}>

      {/* ── 헤더 ── */}
      <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--line)",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        flexWrap:"wrap", gap:10, background:"#f8fafc" }}>
        <div>
          <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:"#1e293b" }}>
            📅 수업 시간표
          </h2>
          <p style={{ margin:"3px 0 0", fontSize:12, color:"#64748b" }}>
            06:00 ~ 24:00 · 30분 단위 · 일~토
          </p>
        </div>
        <button onClick={() => openAdd()}
          style={{ padding:"8px 18px", borderRadius:8, border:"none",
            background:"#0891b2", color:"#fff", fontWeight:700, fontSize:13,
            cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
          + 수업 추가
        </button>
      </div>

      {notice && (
        <div style={{ padding:"10px 20px", background:"#f0fdf4",
          borderBottom:"1px solid #86efac", color:"#166534",
          fontSize:13, fontWeight:600 }}>
          {notice}
        </div>
      )}

      {/* ── 시간표 그리드 ── */}
      {loading ? (
        <div style={{ textAlign:"center", padding:"60px 0", color:"#94a3b8" }}>
          불러오는 중…
        </div>
      ) : (
        <div style={{ overflowX:"auto", overflowY:"auto", maxHeight:"80vh" }}>
          <div style={{ display:"flex", minWidth:720 }}>

            {/* 시간 축 */}
            <div style={{ width:60, flexShrink:0, position:"sticky", left:0,
              background:"#f8fafc", zIndex:10, borderRight:"1px solid #e2e8f0" }}>
              <div style={{ height:44, borderBottom:"1px solid #e2e8f0",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:10, fontWeight:700, color:"#94a3b8" }}>
                시간
              </div>
              <div style={{ position:"relative", height:gridH }}>
                {SLOTS.map((slot, i) => (
                  <div key={slot} style={{
                    position:"absolute",
                    top: `${(i / (SLOTS.length-1)) * 100}%`,
                    left:0, right:0,
                    display:"flex", alignItems:"center", justifyContent:"flex-end",
                    paddingRight:6,
                    transform:"translateY(-50%)",
                  }}>
                    <span style={{
                      fontSize: slot.endsWith(":00") ? 11 : 9,
                      color: slot.endsWith(":00") ? "#475569" : "#cbd5e1",
                      fontWeight: slot.endsWith(":00") ? 700 : 400,
                      whiteSpace:"nowrap",
                    }}>
                      {slot.endsWith(":00") ? slot : "·"}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 요일 컬럼 */}
            {DAYS.map(day => {
              const dc = DAY_COLORS[day];
              const dayBlocks = blocksByDay[day] ?? [];
              return (
                <div key={day} style={{ flex:1, minWidth:90, borderRight:"1px solid #e2e8f0" }}>
                  {/* 요일 헤더 */}
                  <div onClick={() => openAdd(day)}
                    style={{ height:44, borderBottom:"1px solid #e2e8f0",
                      background: dc.light, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      gap:4, position:"sticky", top:0, zIndex:5 }}>
                    <span style={{ fontSize:13, fontWeight:800, color: dc.head }}>
                      {day}
                    </span>
                    <span style={{ fontSize:10, color: dc.head, opacity:0.6 }}>+</span>
                  </div>

                  {/* 블록 영역 */}
                  <div style={{ position:"relative", height:gridH, background:"#fafafa" }}>

                    {/* 시간 눈금선 */}
                    {SLOTS.map((slot, i) => (
                      <div key={slot} style={{
                        position:"absolute",
                        top: `${(i / (SLOTS.length-1)) * 100}%`,
                        left:0, right:0,
                        borderTop: slot.endsWith(":00")
                          ? "1px solid #e2e8f0"
                          : "1px dashed #f1f5f9",
                      }}/>
                    ))}

                    {/* 현재 시간 표시선 */}
                    {(() => {
                      const now = new Date();
                      const nowMin = now.getHours()*60 + now.getMinutes() - 6*60;
                      if (nowMin < 0 || nowMin > TOTAL_MIN) return null;
                      const top = (nowMin / TOTAL_MIN) * 100;
                      const todayIdx = now.getDay();
                      if (DAYS[todayIdx] !== day) return null;
                      return (
                        <div style={{ position:"absolute", top:`${top}%`,
                          left:0, right:0, height:2,
                          background:"#ef4444", zIndex:3,
                          boxShadow:"0 0 4px rgba(239,68,68,0.5)" }}>
                          <div style={{ width:8, height:8, borderRadius:"50%",
                            background:"#ef4444", position:"absolute",
                            left:-4, top:-3 }}/>
                        </div>
                      );
                    })()}

                    {/* 수업 블록 */}
                    {dayBlocks.map(block => {
                      const topPct  = (toMin(block.startSlot) / TOTAL_MIN) * 100;
                      const heightPct = ((toMin(block.endSlot) - toMin(block.startSlot)) / TOTAL_MIN) * 100;
                      const stuNames = block.studentCodes
                        .map(c => roster.find(r => r.studentCode === c)?.name ?? c)
                        .join(", ");
                      return (
                        <div key={block.id}
                          onClick={() => openEdit(block)}
                          style={{
                            position:"absolute",
                            top:`${topPct}%`,
                            height:`${heightPct}%`,
                            left:2, right:2, zIndex:2,
                            background: block.color + "22",
                            border:`2px solid ${block.color}`,
                            borderRadius:8, padding:"4px 6px",
                            cursor:"pointer", overflow:"hidden",
                            display:"flex", flexDirection:"column", gap:1,
                            transition:"all 0.15s",
                            boxSizing:"border-box" as const,
                          }}>
                          <div style={{ fontSize:11, fontWeight:800,
                            color: block.color, whiteSpace:"nowrap",
                            overflow:"hidden", textOverflow:"ellipsis" }}>
                            {block.title}
                          </div>
                          <div style={{ fontSize:9, color:"#64748b", whiteSpace:"nowrap",
                            overflow:"hidden", textOverflow:"ellipsis" }}>
                            {block.startSlot}–{block.endSlot}
                          </div>
                          {stuNames && (
                            <div style={{ fontSize:9, color:"#94a3b8",
                              overflow:"hidden", textOverflow:"ellipsis",
                              whiteSpace:"nowrap" }}>
                              {stuNames}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 범례 ── */}
      <div style={{ padding:"10px 20px", borderTop:"1px solid #e2e8f0",
        display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:11, color:"#94a3b8", fontWeight:600 }}>색상:</span>
        {BLOCK_COLORS.map(c => (
          <div key={c.value} style={{ display:"flex", alignItems:"center", gap:4 }}>
            <div style={{ width:12, height:12, borderRadius:3,
              background:c.value, flexShrink:0 }}/>
            <span style={{ fontSize:11, color:"#64748b" }}>{c.label}</span>
          </div>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:4 }}>
          <div style={{ width:16, height:2, background:"#ef4444" }}/>
          <span style={{ fontSize:11, color:"#64748b" }}>현재 시간</span>
        </div>
      </div>

      {/* ── 모달 ── */}
      {modal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center",
          padding:16 }} onClick={e => { if (e.target===e.currentTarget) setModal(null); }}>
          <div style={{ background:"#fff", borderRadius:16, width:"100%",
            maxWidth:480, maxHeight:"90vh", overflow:"auto",
            boxShadow:"0 20px 60px rgba(0,0,0,0.3)" }}>

            {/* 모달 헤더 */}
            <div style={{ padding:"16px 20px", borderBottom:"1px solid #e2e8f0",
              display:"flex", justifyContent:"space-between", alignItems:"center",
              background:"#f8fafc", borderRadius:"16px 16px 0 0" }}>
              <h3 style={{ margin:0, fontSize:15, fontWeight:700, color:"#1e293b" }}>
                {modal==="edit" ? "수업 수정" : "수업 추가"}
              </h3>
              <button onClick={() => setModal(null)}
                style={{ background:"none", border:"none", fontSize:20,
                  color:"#94a3b8", cursor:"pointer", lineHeight:1 }}>✕</button>
            </div>

            <div style={{ padding:20, display:"flex", flexDirection:"column", gap:14 }}>

              {/* 수업 이름 */}
              <div>
                <label style={{ fontSize:12, fontWeight:700, display:"block",
                  marginBottom:5, color:"#374151" }}>수업 이름 *</label>
                <input value={form.title}
                  onChange={e => setForm(f => ({...f, title:e.target.value}))}
                  placeholder="예) 수능영어 심화반, 내신특강"
                  style={{ width:"100%", padding:"10px 12px", borderRadius:8,
                    border:"1.5px solid #0891b2", fontSize:14, fontWeight:600,
                    boxSizing:"border-box" as const }} />
              </div>

              {/* 요일 */}
              <div>
                <label style={{ fontSize:12, fontWeight:700, display:"block",
                  marginBottom:6, color:"#374151" }}>요일</label>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                  {DAYS.map(d => (
                    <button key={d} onClick={() => setForm(f => ({...f, day:d}))}
                      style={{ width:38, height:38, borderRadius:8,
                        border: form.day===d ? `2px solid ${DAY_COLORS[d].head}` : "1px solid #e2e8f0",
                        background: form.day===d ? DAY_COLORS[d].light : "#f8fafc",
                        color: form.day===d ? DAY_COLORS[d].head : "#64748b",
                        fontWeight: form.day===d ? 800 : 500, fontSize:14, cursor:"pointer" }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* 시작 / 종료 */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <label style={{ fontSize:12, fontWeight:700, display:"block",
                    marginBottom:5, color:"#374151" }}>시작 시간</label>
                  <select value={form.startSlot}
                    onChange={e => setForm(f => ({...f, startSlot:e.target.value}))}
                    style={{ width:"100%", padding:"10px 12px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13, fontWeight:600,
                      background:"#fff", boxSizing:"border-box" as const }}>
                    {SLOTS.slice(0,-1).map(s => (
                      <option key={s} value={s}>{slotLabel(s)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize:12, fontWeight:700, display:"block",
                    marginBottom:5, color:"#374151" }}>종료 시간</label>
                  <select value={form.endSlot}
                    onChange={e => setForm(f => ({...f, endSlot:e.target.value}))}
                    style={{ width:"100%", padding:"10px 12px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13, fontWeight:600,
                      background:"#fff", boxSizing:"border-box" as const }}>
                    {SLOTS.slice(1).map(s => (
                      <option key={s} value={s}>{slotLabel(s)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 색상 */}
              <div>
                <label style={{ fontSize:12, fontWeight:700, display:"block",
                  marginBottom:6, color:"#374151" }}>색상</label>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  {BLOCK_COLORS.map(c => (
                    <button key={c.value} onClick={() => setForm(f => ({...f, color:c.value}))}
                      title={c.label}
                      style={{ width:32, height:32, borderRadius:8, border:"none",
                        background:c.value, cursor:"pointer",
                        outline: form.color===c.value ? `3px solid ${c.value}` : "none",
                        outlineOffset:2,
                        transform: form.color===c.value ? "scale(1.2)" : "scale(1)",
                        transition:"all 0.15s" }} />
                  ))}
                </div>
              </div>

              {/* 학생 선택 */}
              <div>
                <label style={{ fontSize:12, fontWeight:700, display:"block",
                  marginBottom:5, color:"#374151" }}>
                  학생 선택 ({form.studentCodes.length}명)
                </label>
                <input value={stuSearch}
                  onChange={e => setStuSearch(e.target.value)}
                  placeholder="이름 또는 학교 검색…"
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7,
                    border:"1px solid #e2e8f0", fontSize:12, marginBottom:6,
                    boxSizing:"border-box" as const }} />
                <div style={{ maxHeight:160, overflowY:"auto", border:"1px solid #e2e8f0",
                  borderRadius:8, padding:4 }}>
                  {filteredRoster.length === 0 ? (
                    <p style={{ textAlign:"center", color:"#94a3b8",
                      fontSize:12, padding:"12px 0", margin:0 }}>학생 없음</p>
                  ) : filteredRoster.map(r => {
                    const selected = form.studentCodes.includes(r.studentCode);
                    return (
                      <div key={r.studentCode} onClick={() => toggleStudent(r.studentCode)}
                        style={{ display:"flex", alignItems:"center", gap:8,
                          padding:"6px 8px", borderRadius:6, cursor:"pointer",
                          background: selected ? "#e0f2fe" : "transparent",
                          marginBottom:2 }}>
                        <div style={{ width:20, height:20, borderRadius:5,
                          border:`1.5px solid ${selected ? "#0891b2" : "#cbd5e1"}`,
                          background: selected ? "#0891b2" : "#fff",
                          display:"flex", alignItems:"center", justifyContent:"center",
                          flexShrink:0 }}>
                          {selected && <span style={{ color:"#fff", fontSize:12, lineHeight:1 }}>✓</span>}
                        </div>
                        <span style={{ fontSize:12, fontWeight: selected ? 700 : 400,
                          color: selected ? "#0c4a6e" : "#374151" }}>
                          {r.name}
                        </span>
                        <span style={{ fontSize:10, color:"#94a3b8", marginLeft:"auto" }}>
                          {r.school} {r.grade}학년
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 메모 */}
              <div>
                <label style={{ fontSize:12, fontWeight:700, display:"block",
                  marginBottom:5, color:"#374151" }}>메모 (선택)</label>
                <textarea value={form.note}
                  onChange={e => setForm(f => ({...f, note:e.target.value}))}
                  placeholder="특이사항, 강의실, 준비물 등"
                  rows={2}
                  style={{ width:"100%", padding:"8px 10px", borderRadius:7,
                    border:"1px solid #e2e8f0", fontSize:12,
                    resize:"none" as const, boxSizing:"border-box" as const }} />
              </div>

              {notice && (
                <div style={{ padding:"8px 12px", borderRadius:7, fontSize:12,
                  background:"#fef2f2", border:"1px solid #fca5a5", color:"#dc2626" }}>
                  {notice}
                </div>
              )}

              {/* 버튼 */}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={handleSave} disabled={saving}
                  style={{ flex:1, padding:"12px", borderRadius:10, border:"none",
                    background: saving ? "#e2e8f0" : "#0891b2",
                    color: saving ? "#94a3b8" : "#fff",
                    fontWeight:700, fontSize:15, cursor: saving ? "not-allowed" : "pointer" }}>
                  {saving ? "저장 중…" : modal==="edit" ? "수정 저장" : "수업 추가"}
                </button>
                {modal==="edit" && editId && (
                  <button onClick={() => { deleteBlock(editId); setModal(null); }}
                    style={{ padding:"12px 16px", borderRadius:10,
                      border:"1px solid #fca5a5", background:"#fff",
                      color:"#ef4444", fontSize:13, fontWeight:600, cursor:"pointer" }}>
                    삭제
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Locate, CheckCircle, Settings, Plus, X, Repeat, Pin } from "lucide-react";
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
  // 특정 주(일요일 날짜, "YYYY-MM-DD")에만 적용되는 예외 수정. 비어있으면
  // 매주 반복 적용(기존 동작, 자동생성 대비 override). 있으면 그 주에서만
  // 자동생성 값을 덮어쓰고 다른 주는 그대로 자동생성 값을 보여준다.
  weekStart?: string;
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

// 과거/미래로 몇 주까지 스크롤해서 보여줄지 (좌우 스크롤로 주 단위 이동)
const WEEKS_BEFORE = 4;
const WEEKS_AFTER = 12;

function getSundayOf(date: Date): Date {
  const s = new Date(date);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay());
  return s;
}
// 주의 일요일 날짜 → "YYYY-MM-DD" (weekStart 키로 사용)
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
// 특정 일요일 기준 해당 주(일~토) 실제 날짜 — 요일 헤더에 함께 표시하기 위함
function getWeekDates(sunday: Date): Record<typeof DAYS[number], Date> {
  const map = {} as Record<typeof DAYS[number], Date>;
  DAYS.forEach((d, i) => {
    const date = new Date(sunday);
    date.setDate(sunday.getDate() + i);
    map[d] = date;
  });
  return map;
}
function fmtMD(d: Date) {
  return `${d.getMonth()+1}/${d.getDate()}`;
}
function isToday(day: typeof DAYS[number], weekDates: Record<typeof DAYS[number], Date>) {
  const today = new Date();
  const d = weekDates[day];
  return d.getFullYear() === today.getFullYear()
    && d.getMonth() === today.getMonth()
    && d.getDate() === today.getDate();
}
// 주 시작일("YYYY-MM-DD") + 요일 → 그 요일의 실제 날짜("YYYY-MM-DD")
function dateOf(weekKey: string, day: typeof DAYS[number]) {
  const d = new Date(`${weekKey}T00:00:00`);
  d.setDate(d.getDate() + DAYS.indexOf(day));
  return ymd(d);
}

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
  // 적용 방식: "recurring"=상시 적용(매주 반복, weekStart 없음), "once"=일시
  // 적용(특정 날짜 하루만, weekStart=그 주 일요일). "once"일 때는 날짜를
  // 고르면 요일이 자동으로 정해진다.
  const [applyMode, setApplyMode] = useState<"recurring"|"once">("recurring");
  const [onceDate, setOnceDate] = useState(""); // "YYYY-MM-DD"

  // 학생 검색
  const [stuSearch, setStuSearch] = useState("");
  const [autoMode, setAutoMode] = useState(true); // 자동 생성 모드

  // 위/아래 동기화 가로 스크롤바 (그리드가 넓어서 아래쪽 스크롤바까지 손이 멀리 가는 문제 대응)
  const topScrollRef = useRef<HTMLDivElement>(null);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  const syncingScrollRef = useRef(false);

  function handleTopScroll() {
    if (syncingScrollRef.current) { syncingScrollRef.current = false; return; }
    if (!topScrollRef.current || !gridScrollRef.current) return;
    syncingScrollRef.current = true;
    gridScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
  }
  function handleGridScroll() {
    if (syncingScrollRef.current) { syncingScrollRef.current = false; return; }
    if (!topScrollRef.current || !gridScrollRef.current) return;
    syncingScrollRef.current = true;
    topScrollRef.current.scrollLeft = gridScrollRef.current.scrollLeft;
  }

  // 수강 시간표 → 시간표 블록 자동 변환
  const autoGeneratedBlocks = useMemo(() => {
    if (!autoMode || roster.length === 0) return [];

    const DAY_MAP: Record<string, typeof DAYS[number]> = {
      sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토"
    };

    const blockMap = new Map<string, TimetableBlock>();

    roster.forEach(student => {
      if (!student.lessonSchedule || student.lessonSchedule.length === 0) return;

      student.lessonSchedule.forEach(schedule => {
        const dayLabel = DAY_MAP[schedule.day] || "월";
        const key = `${dayLabel}|${schedule.startTime}|${schedule.endTime}`;

        if (blockMap.has(key)) {
          const block = blockMap.get(key)!;
          if (!block.studentCodes.includes(student.studentCode)) {
            block.studentCodes.push(student.studentCode);
          }
        } else {
          blockMap.set(key, {
            id: `auto-${key}`,
            day: dayLabel,
            startSlot: schedule.startTime,
            endSlot: schedule.endTime,
            studentCodes: [student.studentCode],
            title: "",
            color: "#0891b2",
            note: "자동생성",
          });
        }
      });
    });

    // 학생 수 업데이트
    blockMap.forEach(block => {
      block.title = `${block.studentCodes.length}명`;
    });

    return Array.from(blockMap.values()).sort((a, b) => {
      const aMin = toMin(a.startSlot);
      const bMin = toMin(b.startSlot);
      return aMin - bMin;
    });
  }, [roster, autoMode]);

  const [withdrawnCodes, setWithdrawnCodes] = useState<Set<string> | null>(null);
  useEffect(() => {
    rosterStore.listRoster().then(r => {
      const filtered = r.filter(s => (s.studentStatus ?? "active") !== "withdrawn");
      setRoster(filtered);
      const withdrawn = new Set(
        r.filter(s => (s.studentStatus ?? "active") === "withdrawn").map(s => s.studentCode)
      );
      if (withdrawn.size > 0) setWithdrawnCodes(withdrawn);
    });
    loadBlocks();
  }, []);

  // 학생이 퇴원하면 그 학생이 들어간 시간표 수정 정보(수동 override)는 그
  // 시점부터 전부 삭제한다 — 여러 명이 같이 듣는 수업이면 그 학생 코드만
  // 빼고, 그 결과 학생이 0명이 되면 블록 자체를 삭제한다. (자동생성 블록은
  // roster에서 이미 퇴원생을 뺐으므로 별도 처리가 필요 없다.)
  const sweepDoneRef = useRef(false);
  useEffect(() => {
    if (loading || sweepDoneRef.current) return;
    const withdrawn = withdrawnCodes;
    if (!withdrawn || withdrawn.size === 0) return;
    sweepDoneRef.current = true;

    const toDelete: string[] = [];
    const toUpdate: TimetableBlock[] = [];
    blocks.forEach(b => {
      if (!b.studentCodes.some(c => withdrawn.has(c))) return;
      const remaining = b.studentCodes.filter(c => !withdrawn.has(c));
      if (remaining.length === 0) toDelete.push(b.id);
      else toUpdate.push({ ...b, studentCodes: remaining });
    });
    if (toDelete.length === 0 && toUpdate.length === 0) return;

    (async () => {
      for (const id of toDelete) {
        await fetch(`${SB_URL}/rest/v1/timetable_blocks?id=eq.${id}`,
          { method:"DELETE", headers: SB_H }).catch(() => {});
      }
      for (const b of toUpdate) {
        await upsertBlockRow(b);
      }
      const next = blocks
        .filter(b => !toDelete.includes(b.id))
        .map(b => toUpdate.find(u => u.id === b.id) ?? b);
      setBlocks(next);
      localStorage.setItem("l16.timetable", JSON.stringify(next));
      setNotice(`퇴원한 학생의 시간표 수정 정보 ${toDelete.length + toUpdate.length}건을 정리했습니다.`);
      setTimeout(() => setNotice(""), 4000);
    })();
  }, [loading, blocks, withdrawnCodes]);

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
        weekStart: r.week_start ?? undefined,
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

  async function upsertBlockRow(block: TimetableBlock) {
    const row = {
      id: block.id, day: block.day,
      start_slot: block.startSlot, end_slot: block.endSlot,
      student_codes: JSON.stringify(block.studentCodes),
      title: block.title, color: block.color, note: block.note,
      week_start: block.weekStart ?? null,
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
  }

  async function saveBlock(block: TimetableBlock) {
    setSaving(true);
    await upsertBlockRow(block);
    // editId가 있어도 blocks(수동 목록)에 아직 없는 경우가 있다 — 자동생성
    // 블록을 처음 수정해서 override로 저장하는 경우. 그때는 없으니 추가한다.
    const exists = editId ? blocks.some(b => b.id === editId) : false;
    const next = exists
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

  // weekKey: 어떤 주 칸에서 열었는지(일요일 "YYYY-MM-DD"). 있으면 기본
  // 적용 방식을 "일시 적용"으로 켜고 그 칸의 실제 날짜를 채워준다 — 실제
  // 적용 방식은 모달의 상시/일시 토글로 사용자가 바꿀 수 있다.
  function openAdd(day?: typeof DAYS[number], weekKey?: string) {
    setForm({ ...EMPTY_BLOCK, day: day ?? "월" });
    setEditId(null);
    setStuSearch("");
    if (weekKey && day) {
      setApplyMode("once");
      setOnceDate(dateOf(weekKey, day));
    } else {
      setApplyMode("recurring");
      setOnceDate("");
    }
    setModal("add");
  }

  function openEdit(block: TimetableBlock, weekKey?: string) {
    setForm({ day:block.day, startSlot:block.startSlot, endSlot:block.endSlot,
      studentCodes:[...block.studentCodes], title:block.title, color:block.color, note:block.note });
    setEditId(block.id);
    setStuSearch("");
    const effectiveWeekKey = weekKey ?? block.weekStart;
    if (effectiveWeekKey) {
      setApplyMode("once");
      setOnceDate(dateOf(effectiveWeekKey, block.day));
    } else {
      setApplyMode("recurring");
      setOnceDate("");
    }
    setModal("edit");
  }

  async function handleSave() {
    if (!form.title.trim()) { setNotice("수업 이름을 입력해주세요."); return; }
    if (form.startSlot >= form.endSlot) { setNotice("종료 시간이 시작 시간보다 뒤여야 합니다."); return; }
    let day = form.day;
    let weekStart: string | undefined;
    if (applyMode === "once") {
      if (!onceDate) { setNotice("적용할 날짜를 선택해주세요."); return; }
      const d = new Date(`${onceDate}T00:00:00`);
      day = DAYS[d.getDay()];
      weekStart = ymd(getSundayOf(d));
    }
    // 자동생성 블록(id가 "auto-"로 시작)은 논리적으로 계산된 값일 뿐 DB에 있는
    // 행이 아니고, DB의 id 컬럼은 uuid 타입이라 "auto-..." 문자열을 그대로 넣으면
    // 저장이 실패한다. 그래서 자동 블록을 수정하는 경우엔 새 uuid를 발급해
    // "수동 override" 행으로 새로 저장한다 — 화면에는 같은 시간대라 자동값 대신
    // 이 override가 표시된다(위 blocksByWeekDay 참고).
    const isAutoBlock = editId?.startsWith("auto-") ?? false;
    const block: TimetableBlock = {
      id: isAutoBlock ? uuid() : (editId ?? uuid()),
      ...form,
      day,
      weekStart,
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

  // 과거 WEEKS_BEFORE주 ~ 미래 WEEKS_AFTER주를 가로로 이어서 렌더링 —
  // 좌우로 스크롤하면 지난 주/다음 주 시간표가 이어서 나오고, 각 주 칸을
  // 눌러 수정하면 "그 주만" 예외로 저장된다(자동생성 반복 시간표 자체는 유지).
  const thisWeekStart = useMemo(() => getSundayOf(new Date()), []);
  const thisWeekKey = useMemo(() => ymd(thisWeekStart), [thisWeekStart]);
  const weekStarts = useMemo(() => {
    return Array.from({ length: WEEKS_BEFORE + WEEKS_AFTER + 1 }, (_, i) => {
      const d = new Date(thisWeekStart);
      d.setDate(thisWeekStart.getDate() + (i - WEEKS_BEFORE) * 7);
      return d;
    });
  }, [thisWeekStart]);

  const blocksByWeekDay = useMemo(() => {
    const map: Record<string, Record<string, TimetableBlock[]>> = {};
    weekStarts.forEach(ws => {
      const weekKey = ymd(ws);
      const dayMap: Record<string, TimetableBlock[]> = {};
      DAYS.forEach(d => dayMap[d] = []);

      if (!autoMode) {
        blocks.forEach(b => { if (dayMap[b.day]) dayMap[b.day].push(b); });
        map[weekKey] = dayMap;
        return;
      }

      // 자동 생성 블록을 기본으로 쓰되, 같은 시간대(요일+시작+종료)에 수동
      // 수정(override)이 있으면 그걸 우선한다. override 중 weekStart가 없는
      // 것은 "매주 반복 적용"(기존 동작), weekStart가 이 주와 일치하는 것은
      // "이 주만 예외 적용"으로 우선순위가 더 높다.
      DAYS.forEach(day => {
        const dayAuto = autoGeneratedBlocks.filter(b => b.day === day);
        const dayOverrides = blocks.filter(b => b.day === day);
        const recurring = new Map<string, TimetableBlock>();
        const exact = new Map<string, TimetableBlock>();
        dayOverrides.forEach(b => {
          const key = `${b.startSlot}|${b.endSlot}`;
          if (!b.weekStart) recurring.set(key, b);
          else if (b.weekStart === weekKey) exact.set(key, b);
        });
        const usedKeys = new Set<string>();
        dayAuto.forEach(auto => {
          const key = `${auto.startSlot}|${auto.endSlot}`;
          usedKeys.add(key);
          dayMap[day].push(exact.get(key) ?? recurring.get(key) ?? auto);
        });
        // 자동생성 시간대와 겹치지 않는, 이 주에 직접 추가된 블록
        dayOverrides.forEach(b => {
          const key = `${b.startSlot}|${b.endSlot}`;
          if (usedKeys.has(key)) return;
          if (b.weekStart && b.weekStart !== weekKey) return;
          dayMap[day].push(b);
        });
      });
      map[weekKey] = dayMap;
    });
    return map;
  }, [blocks, autoGeneratedBlocks, autoMode, weekStarts]);

  // 그리드 실제 너비 측정 (위쪽 동기화 스크롤바의 스페이서 폭으로 사용)
  useEffect(() => {
    function measure() {
      if (gridScrollRef.current) setGridWidth(gridScrollRef.current.scrollWidth);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [blocksByWeekDay, loading]);

  // 이번 주 칸으로 스크롤 이동 (최초 로딩 시 자동으로, 버튼으로 언제든 다시)
  function scrollToThisWeek() {
    const container = gridScrollRef.current;
    const target = container?.querySelector(`[data-week-start="${thisWeekKey}"]`) as HTMLElement | null;
    if (!container || !target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offset = targetRect.left - containerRect.left + container.scrollLeft - 4;
    container.scrollLeft = Math.max(0, offset);
    if (topScrollRef.current) topScrollRef.current.scrollLeft = container.scrollLeft;
  }
  useEffect(() => {
    if (loading) return;
    scrollToThisWeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
          <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:"#1e293b",
            display:"flex", alignItems:"center", gap:6 }}>
            <CalendarDays size={17}/> 수업 시간표
          </h2>
          <p style={{ margin:"3px 0 0", fontSize:12, color:"#64748b" }}>
            06:00 ~ 24:00 · 30분 단위 · 일~토
          </p>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <button onClick={scrollToThisWeek}
            style={{ padding:"8px 14px", borderRadius:8, border:"1px solid #cbd5e1",
              background:"#fff", color:"#475569", fontWeight:700, fontSize:12, cursor:"pointer",
              display:"flex", alignItems:"center", gap:5 }}>
            <Locate size={14}/> 이번 주로 이동
          </button>
          <button onClick={() => setAutoMode(!autoMode)}
            style={{ padding:"8px 16px", borderRadius:8, border:"1px solid #cbd5e1",
              background: autoMode ? "#e0f2fe" : "#fff", color: autoMode ? "#0891b2" : "#64748b",
              fontWeight:700, fontSize:12, cursor:"pointer",
              display:"flex", alignItems:"center", gap:5 }}>
            {autoMode ? <CheckCircle size={14}/> : <Settings size={14}/>}
            {autoMode ? "자동생성" : "수동편집"}
          </button>
          <button onClick={() => openAdd()}
            style={{ padding:"8px 18px", borderRadius:8, border:"none",
              background:"#0891b2", color:"#fff", fontWeight:700, fontSize:13,
              cursor:"pointer", display:"flex", alignItems:"center", gap:6 }}>
            <Plus size={15}/> 수업 추가
          </button>
        </div>
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
        <>
          {/* 위쪽 동기화 가로 스크롤바 — 그리드 아래쪽 스크롤바까지 손이 멀리 가는 문제 대응 */}
          <div ref={topScrollRef} onScroll={handleTopScroll}
            style={{ overflowX:"auto", overflowY:"hidden", height:14 }}>
            <div style={{ width: gridWidth || 720, height:1 }} />
          </div>
          <div ref={gridScrollRef} onScroll={handleGridScroll}
            style={{ overflowX:"auto", overflowY:"auto", maxHeight:"80vh" }}>
          <div style={{ display:"flex", minWidth:720 }}>

            {/* 시간 축 */}
            <div style={{ width:60, flexShrink:0, position:"sticky", left:0,
              background:"#f8fafc", zIndex:10, borderRight:"1px solid #e2e8f0" }}>
              <div style={{ height:52, borderBottom:"1px solid #e2e8f0",
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

            {/* 주 단위로 이어서 렌더링 — 좌우로 스크롤하면 지난/다음 주가 계속 나옴 */}
            {weekStarts.map(ws => {
              const weekKey = ymd(ws);
              const weekDates = getWeekDates(ws);
              return (
                <Fragment key={weekKey}>
                  {DAYS.map(day => {
                    const dc = DAY_COLORS[day];
                    const dayBlocks = blocksByWeekDay[weekKey]?.[day] ?? [];
                    return (
                      <div key={`${weekKey}-${day}`}
                        data-week-start={day === "일" ? weekKey : undefined}
                        style={{ flex:1, minWidth:90, borderRight:"1px solid #e2e8f0",
                          borderLeft: day === "일" ? "3px solid #cbd5e1" : undefined }}>
                        {/* 요일 헤더 (+ 해당 주 날짜) */}
                        <div onClick={() => openAdd(day, weekKey)}
                          style={{ height:52, borderBottom:"1px solid #e2e8f0",
                            background: dc.light, cursor:"pointer",
                            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                            gap:1, position:"sticky", top:0, zIndex:5 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <span style={{ fontSize:13, fontWeight:800, color: dc.head }}>
                              {day}
                            </span>
                            <span style={{ fontSize:10, color: dc.head, opacity:0.6 }}>+</span>
                          </div>
                          <span style={{
                            fontSize:10, fontWeight: isToday(day, weekDates) ? 800 : 500,
                            color: isToday(day, weekDates) ? "#fff" : dc.head,
                            background: isToday(day, weekDates) ? dc.head : "transparent",
                            padding: isToday(day, weekDates) ? "0 5px" : 0,
                            borderRadius:4, opacity: isToday(day, weekDates) ? 1 : 0.75,
                          }}>
                            {fmtMD(weekDates[day])}
                          </span>
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

                          {/* 현재 시간 표시선 (이번 주에만) */}
                          {weekKey === thisWeekKey && (() => {
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
                              <div key={`${weekKey}-${block.id}`}
                                onClick={() => openEdit(block, weekKey)}
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
                </Fragment>
              );
            })}
          </div>
          </div>
        </>
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
                style={{ background:"none", border:"none",
                  color:"#94a3b8", cursor:"pointer", lineHeight:1,
                  display:"flex", alignItems:"center" }}><X size={20}/></button>
            </div>

            <div style={{ padding:20, display:"flex", flexDirection:"column", gap:14 }}>

              {/* 적용 방식 */}
              <div>
                <label style={{ fontSize:12, fontWeight:700, display:"block",
                  marginBottom:6, color:"#374151" }}>적용 방식</label>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={() => setApplyMode("recurring")}
                    style={{ flex:1, padding:"9px", borderRadius:8,
                      border: applyMode==="recurring" ? "2px solid #0891b2" : "1px solid #e2e8f0",
                      background: applyMode==="recurring" ? "#e0f2fe" : "#f8fafc",
                      color: applyMode==="recurring" ? "#0891b2" : "#64748b",
                      fontWeight:700, fontSize:12, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                    <Repeat size={14}/> 상시 적용 (매주 반복)
                  </button>
                  <button onClick={() => setApplyMode("once")}
                    style={{ flex:1, padding:"9px", borderRadius:8,
                      border: applyMode==="once" ? "2px solid #0891b2" : "1px solid #e2e8f0",
                      background: applyMode==="once" ? "#e0f2fe" : "#f8fafc",
                      color: applyMode==="once" ? "#0891b2" : "#64748b",
                      fontWeight:700, fontSize:12, cursor:"pointer",
                      display:"flex", alignItems:"center", justifyContent:"center", gap:5 }}>
                    <Pin size={14}/> 일시 적용 (하루만)
                  </button>
                </div>
                {applyMode === "once" && (
                  <p style={{ fontSize:11, color:"#94a3b8", margin:"6px 0 0" }}>
                    선택한 날짜에만 적용되는 예외입니다. 매주 반복되는 자동생성
                    시간표 자체는 바뀌지 않아요.
                  </p>
                )}
              </div>

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

              {/* 요일 (상시 적용) / 날짜 (일시 적용) */}
              {applyMode === "once" ? (
                <div>
                  <label style={{ fontSize:12, fontWeight:700, display:"block",
                    marginBottom:6, color:"#374151" }}>날짜</label>
                  <input type="date" value={onceDate}
                    min={ymd(weekStarts[0])}
                    max={ymd(new Date(weekStarts[weekStarts.length-1].getTime() + 6*86400000))}
                    onChange={e => setOnceDate(e.target.value)}
                    style={{ width:"100%", padding:"10px 12px", borderRadius:8,
                      border:"1px solid #e2e8f0", fontSize:13, fontWeight:600,
                      background:"#fff", boxSizing:"border-box" as const }} />
                  {onceDate && (
                    <p style={{ fontSize:12, color:"#0891b2", fontWeight:700, margin:"6px 0 0" }}>
                      → {DAYS[new Date(`${onceDate}T00:00:00`).getDay()]}요일
                    </p>
                  )}
                </div>
              ) : (
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
              )}

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

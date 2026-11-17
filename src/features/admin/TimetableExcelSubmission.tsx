import { useMemo, useState } from "react";
import type { RosterEntry } from "../../core/roster";
import { analyzeTimetableCalendar, analyzeTimetableRows, scheduleLabel, TIMETABLE_EXCEL_NOTE_PREFIX, TIMETABLE_HIDE_AUTO_NOTE, TIMETABLE_HIDE_FUTURE_NOTE, TIMETABLE_FUTURE_NOTE_PREFIX, type TimetableCalendarWeek, type TimetableImportRow } from "../../lib/timetableImport";
import { createRosterStore } from "../../lib/rosterStoreFactory";

const STATUS_LABEL: Record<TimetableImportRow["status"], string> = {
  match: "일치", new: "시간표 추가", changed: "변경 감지", not_in_file: "엑셀에 없음", ambiguous: "확인 필요", invalid: "형식 확인",
};

export default function TimetableExcelSubmission({ roster, onApplied }: { roster: RosterEntry[]; onApplied: (next: RosterEntry[]) => void }) {
  const store = useMemo(() => createRosterStore(), []);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<TimetableImportRow[]>([]);
  const [calendarWeeks, setCalendarWeeks] = useState<TimetableCalendarWeek[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleFile(file?: File) {
    if (!file) return;
    setBusy(true); setError(""); setRows([]); setCalendarWeeks([]); setSelected([]); setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      let analyzed: TimetableImportRow[] | null = null;
      let calendar: TimetableCalendarWeek[] = [];
      let lastError = "";
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
        try { analyzed = analyzeTimetableRows(data, roster); break; }
        catch (e) { lastError = (e as Error).message; }
        if (!calendar.length) calendar = analyzeTimetableCalendar(data, roster, "2026-11-15");
      }
      if (analyzed) {
        setRows(analyzed);
        setSelected(analyzed.filter((r) => r.status === "new" || r.status === "changed").map((r) => r.studentCode));
      } else if (calendar.length) setCalendarWeeks(calendar);
      else throw new Error(lastError || "읽을 수 있는 시간표 시트를 찾지 못했습니다.");
    } catch (e) { setError((e as Error).message || "엑셀 파일을 읽지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function applySelected() {
    const codes = new Set(selected);
    const target = rows.filter((r) => codes.has(r.studentCode) && (r.status === "new" || r.status === "changed") && r.proposed.length);
    if (!target.length) return;
    if (!confirm(`${target.length}명의 학생 시간표를 엑셀 내용으로 반영할까요? 학생별 기존 수업 출결 기록은 유지됩니다.`)) return;
    setBusy(true); setError("");
    try {
      const byCode = new Map(target.map((r) => [r.studentCode, r.proposed]));
      await store.saveRoster(roster.filter((r) => byCode.has(r.studentCode)).map((r) => {
        const lessonSchedule = byCode.get(r.studentCode)!;
        const lessonDays = lessonSchedule.reduce((days, slot) => {
          days[slot.day] = Math.min(2, (days[slot.day] ?? 0) + 1) as 1 | 2;
          return days;
        }, {} as NonNullable<RosterEntry["lessonDays"]>);
        return { ...r, lessonSchedule, lessonDays };
      }));
      onApplied(await store.listRoster());
      setRows((prev) => prev.map((r) => byCode.has(r.studentCode) ? { ...r, status: "match", detail: "엑셀 시간표 반영 완료" } : r));
      setSelected([]);
    } catch (e) { setError(`반영에 실패했습니다: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  async function applyCalendar() {
    const currentWeek = calendarWeeks.find((w) => w.weekStart === "2026-11-15");
    const futureWeeks = calendarWeeks.filter((w) => w.weekStart >= "2026-11-22");
    if (!futureWeeks.length) return;
    const canonical = futureWeeks[0];
    const total = canonical.slots.reduce((n, slot) => n + slot.studentCodes.length, 0);
    const exceptions = futureWeeks.slice(1).filter((week) => scheduleSignature(week) !== scheduleSignature(canonical));
    const uncertainty = currentWeek?.uncertainStudentCodes.length ?? 0;
    if (!confirm(`11월 15일 주간 일정과 11월 22일 이후 반복 시간표를 엑셀 내용으로 반영합니다. 이후 시간표의 자동 명단은 엑셀 일정으로 대체되어 줄어든 학생은 사라집니다. 11월 15일 주간에서 판독이 애매한 학생 ${uncertainty}명은 기존 일정을 유지합니다. 학생 명부와 과거 수업 기록은 보존합니다. 계속할까요?`)) return;
    setBusy(true); setError("");
    try {
      const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
      if (!url || !key) throw new Error("시간표 DB 연결 설정이 없습니다.");
      const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
      const first = currentWeek?.weekStart ?? canonical.weekStart;
      const last = futureWeeks[futureWeeks.length - 1].weekStart;
      const existingRes = await fetch(`${url}/rest/v1/timetable_blocks?select=id,day,start_slot,end_slot,week_start,note,color,title,student_codes&week_start=gte.${first}&week_start=lte.${last}`, { headers });
      if (!existingRes.ok) throw new Error(`기존 시간표 조회 실패 (${existingRes.status})`);
      const existing = await existingRes.json() as Array<{ id: string; day: string; start_slot: string; end_slot: string; week_start: string; note?: string; color?: string; title?: string; student_codes?: string | string[] }>;
      const recurringRes = await fetch(`${url}/rest/v1/timetable_blocks?select=id,day,start_slot,end_slot,week_start,note,color,title,student_codes&week_start=is.null`, { headers });
      if (!recurringRes.ok) throw new Error(`반복 시간표 조회 실패 (${recurringRes.status})`);
      const recurringBlocks = await recurringRes.json() as Array<{ day: string; start_slot: string; end_slot: string; student_codes?: string | string[] }>;
      const dayNames = { sun: "일", mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토" } as const;
      const baseline = new Map<string, Set<string>>();
      roster.filter((student) => (student.studentStatus ?? "active") !== "withdrawn").forEach((student) => (student.lessonSchedule ?? []).forEach((s) => {
        const day = dayNames[s.day]; const slotKey = `${day}|${s.startTime}|${s.endTime}`;
        baseline.set(slotKey, new Set([...(baseline.get(slotKey) ?? []), student.studentCode]));
      }));
      [...existing, ...recurringBlocks].forEach((block) => {
        const codes = typeof block.student_codes === "string" ? JSON.parse(block.student_codes || "[]") as string[] : block.student_codes ?? [];
        if (!codes.length) return;
        const slotKey = `${block.day}|${block.start_slot}|${block.end_slot}`;
        baseline.set(slotKey, new Set([...(baseline.get(slotKey) ?? []), ...codes]));
      });
      const rowsForWeek = (week: TimetableCalendarWeek, mode: "exact" | "future") => {
        const target = new Map(week.slots.map((slot) => [`${dayNames[slot.day]}|${slot.startTime}|${slot.endTime}`, slot]));
        const slots = new Map<string, { day: string; start: string; end: string; codes: string[]; hidden: boolean }>();
        const uncertain = new Set(week.uncertainStudentCodes);
        baseline.forEach((codes, slotKey) => {
          const [day, start, end] = slotKey.split("|"); const slot = target.get(slotKey);
          const keep = !slot && mode === "exact" ? [...codes].filter((code) => uncertain.has(code)) : [];
          slots.set(slotKey, { day, start, end, codes: slot?.studentCodes ?? keep, hidden: !slot && keep.length === 0 });
        });
        if (mode === "exact" && week.weekStart > canonical.weekStart) canonical.slots.forEach((slot) => {
          const day = dayNames[slot.day]; const slotKey = `${day}|${slot.startTime}|${slot.endTime}`;
          if (!target.has(slotKey) && !slots.has(slotKey)) slots.set(slotKey, { day, start: slot.startTime, end: slot.endTime, codes: [], hidden: true });
        });
        week.slots.forEach((slot) => {
          const day = dayNames[slot.day]; const slotKey = `${day}|${slot.startTime}|${slot.endTime}`;
          slots.set(slotKey, { day, start: slot.startTime, end: slot.endTime, codes: slot.studentCodes, hidden: false });
        });
        return [...slots.entries()].map(([slotKey, slot]) => {
          const startWeek = mode === "future" ? canonical.weekStart : week.weekStart;
          const old = existing.find((b) => b.week_start === startWeek && b.day === slot.day && b.start_slot === slot.start && b.end_slot === slot.end);
          const note = slot.hidden
            ? mode === "future" ? `${TIMETABLE_HIDE_FUTURE_NOTE}|${canonical.weekStart}` : TIMETABLE_HIDE_AUTO_NOTE
            : mode === "future" ? `${TIMETABLE_FUTURE_NOTE_PREFIX}|${canonical.weekStart}` : `${TIMETABLE_EXCEL_NOTE_PREFIX}|${week.weekStart}`;
          return { id: old?.id ?? crypto.randomUUID(), day: slot.day, start_slot: slot.start, end_slot: slot.end,
            student_codes: JSON.stringify(slot.codes), title: "", color: old?.color ?? "#0891b2", note,
            week_start: startWeek, cancelled: false, absent_student_codes: "[]", moved: false };
        });
      };
      const payload: Record<string, unknown>[] = [...rowsForWeek(canonical, "future")];
      if (currentWeek) payload.push(...rowsForWeek(currentWeek, "exact"));
      for (const exception of exceptions) payload.push(...rowsForWeek(exception, "exact"));
      const writeRes = await fetch(`${url}/rest/v1/timetable_blocks`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(payload) });
      if (!writeRes.ok) throw new Error(`시간표 저장 실패 (${writeRes.status})`);
      setError("");
      alert(`11월 15일 주간과 11월 22일부터 반복되는 시간표를 반영했습니다. 반복 일정 ${total}건, 주별 예외 ${exceptions.length}주입니다. 시간표 탭을 다시 열어 확인해 주세요.`);
    } catch (e) { setError(`엑셀 시간표 반영 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  function scheduleSignature(week: TimetableCalendarWeek) {
    return week.slots.map((slot) => `${slot.day}|${slot.startTime}|${slot.endTime}|${[...slot.studentCodes].sort().join(",")}`).sort().join(";");
  }

  const selectedCount = rows.filter((r) => selected.includes(r.studentCode) && (r.status === "new" || r.status === "changed")).length;
  const count = (status: TimetableImportRow["status"]) => rows.filter((r) => r.status === status).length;

  return <section style={{ border: "1px solid #cbd5e1", borderRadius: 12, padding: 16, margin: "16px 0", background: "#f8fafc" }}>
    <h3 style={{ margin: "0 0 6px" }}>📅 시간표 엑셀 제출·자동 대조</h3>
    <p className="muted" style={{ margin: "0 0 12px" }}>행목록형 엑셀과 현재 사용하는 주별 달력형 시간표를 읽어 학생 명부·반복 시간표와 대조합니다. 줄어든 이름은 해당 주와 이후 반복 일정에서 자동으로 빠집니다.</p>
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 12px", border: "1px solid #64748b", borderRadius: 8, background: "white", cursor: "pointer", fontWeight: 700 }}>
      {busy ? "엑셀 처리 중…" : "엑셀 시간표 선택"}<input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(e) => handleFile(e.target.files?.[0])} style={{ maxWidth: 220 }} />
    </label>
    {fileName && <span style={{ marginLeft: 10, color: "#475569" }}>{fileName}</span>}
    {error && <p role="alert" style={{ color: "#b91c1c", fontWeight: 600 }}>{error}</p>}
    {calendarWeeks.length > 0 && <>
      <div style={{ marginTop: 12, padding: 12, background: "#fff", border: "1px solid #cbd5e1", borderRadius: 8 }}>
        <strong>주별 달력 시간표 인식</strong>
        <p className="muted" style={{ margin: "4px 0 8px" }}>11월 15일 이후 {calendarWeeks.length}주를 읽었습니다. 11월 15일 주는 엑셀 일정으로 정리하고, 11월 22일부터는 새 반복 시간표로 적용합니다. 판독이 애매한 현재 주 일정은 기존 위치를 유지합니다.</p>
        <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6 }}>
          {calendarWeeks.map((week) => <div key={week.weekStart} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, fontSize: 12 }}><b>{week.weekStart}</b><br />수업 칸 {week.slots.reduce((n, slot) => n + slot.studentCodes.length, 0)}개{week.uncertainStudentCodes.length ? <span style={{ color: "#b45309" }}> · 기존 유지 {week.uncertainStudentCodes.length}명</span> : null}</div>)}
        </div>
        <button className="btn secondary" disabled={busy || !calendarWeeks.some((w) => w.weekStart >= "2026-11-22" && w.slots.length > 0)} onClick={applyCalendar} style={{ marginTop: 10 }}>엑셀 시간표 반영</button>
      </div>
    </>}
    {rows.length > 0 && <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0", fontSize: 13 }}>
        <span>변경 {count("changed")}</span><span>신규 {count("new")}</span><span>일치 {count("match")}</span><span>엑셀 누락 {count("not_in_file")}</span><span>확인 필요 {count("ambiguous") + count("invalid")}</span>
        <button className="btn ghost" onClick={() => setSelected(rows.filter((r) => (r.status === "new" || r.status === "changed") && !selected.includes(r.studentCode)).map((r) => r.studentCode))}>변경 일정 선택</button>
        <button className="btn secondary" disabled={busy || !selectedCount} onClick={applySelected}>선택 일정 반영 ({selectedCount})</button>
      </div>
      <div style={{ overflowX: "auto", maxHeight: 360, border: "1px solid #e2e8f0", borderRadius: 8, background: "white" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ position: "sticky", top: 0, background: "#eef2ff" }}><th style={{ padding: 8 }}></th><th style={{ padding: 8, textAlign: "left" }}>학생</th><th style={{ padding: 8 }}>대조</th><th style={{ padding: 8, textAlign: "left" }}>엑셀 시간표</th><th style={{ padding: 8, textAlign: "left" }}>확인 내용</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={`${r.studentCode}|${r.status}`} style={{ borderTop: "1px solid #e2e8f0" }}>
            <td style={{ padding: 7, textAlign: "center" }}>{(r.status === "new" || r.status === "changed") && <input aria-label={`${r.name} 시간표 반영 선택`} type="checkbox" checked={selected.includes(r.studentCode)} onChange={(e) => setSelected((p) => e.target.checked ? [...p, r.studentCode] : p.filter((c) => c !== r.studentCode))} />}</td>
            <td style={{ padding: 7, whiteSpace: "nowrap" }}>{r.name}{r.studentCode && <small style={{ color: "#64748b" }}> · {r.studentCode}</small>}</td>
            <td style={{ padding: 7, whiteSpace: "nowrap", textAlign: "center" }}>{STATUS_LABEL[r.status]}</td>
            <td style={{ padding: 7 }}>{r.proposed.length ? scheduleLabel(r.proposed) : "—"}</td>
            <td style={{ padding: 7, color: r.status === "changed" || r.status === "invalid" || r.status === "ambiguous" ? "#b45309" : "#64748b" }}>{r.detail}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}

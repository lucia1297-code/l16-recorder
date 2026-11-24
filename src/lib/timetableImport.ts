import type { DayOfWeek, LessonTime, RosterEntry } from "../core/roster";

export type TimetableImportRow = {
  studentCode: string;
  name: string;
  status: "match" | "new" | "changed" | "not_in_file" | "ambiguous" | "invalid";
  proposed: LessonTime[];
  detail: string;
};

export type TimetableCalendarSlot = { day: DayOfWeek; startTime: string; endTime: string; studentCodes: string[] };
export type TimetableCalendarWeek = { weekStart: string; slots: TimetableCalendarSlot[]; unresolvedCells: number; uncertainStudentCodes: string[]; unmatchedNames: string[] };
export const TIMETABLE_HIDE_AUTO_NOTE = "L16_EXCEL_HIDE_AUTO_V1";
export const TIMETABLE_EXCEL_NOTE_PREFIX = "L16_EXCEL_WEEK_V1";
export const TIMETABLE_HIDE_FUTURE_NOTE = "L16_EXCEL_HIDE_FROM_V1";
export const TIMETABLE_FUTURE_NOTE_PREFIX = "L16_EXCEL_FROM_V1";

const DAY_ALIASES: Record<string, DayOfWeek> = {
  "월": "mon", "월요일": "mon", "mon": "mon", "monday": "mon",
  "화": "tue", "화요일": "tue", "tue": "tue", "tuesday": "tue",
  "수": "wed", "수요일": "wed", "wed": "wed", "wednesday": "wed",
  "목": "thu", "목요일": "thu", "thu": "thu", "thursday": "thu",
  "금": "fri", "금요일": "fri", "fri": "fri", "friday": "fri",
  "토": "sat", "토요일": "sat", "sat": "sat", "saturday": "sat",
  "일": "sun", "일요일": "sun", "sun": "sun", "sunday": "sun",
};
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[\s_\-()]/g, "");
const HEADER_ALIASES = {
  studentCode: ["학생코드", "코드", "학번", "studentcode", "studentid", "id"],
  name: ["학생명", "학생", "이름", "성명", "name", "student", "studentname"],
  day: ["요일", "수업요일", "day", "weekday"],
  start: ["시작", "시작시간", "수업시작", "start", "starttime"],
  end: ["종료", "종료시간", "끝", "수업종료", "end", "endtime"],
};

function parseTime(value: unknown): string | null {
  if (typeof value === "number" && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  const raw = String(value ?? "").trim();
  const m = raw.match(/(오전|오후)?\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?/i);
  if (!m) return null;
  let hour = Number(m[2]);
  const minute = Number(m[3] ?? 0);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null;
  if (m[1] === "오후" && hour < 12) hour += 12;
  if (m[1] === "오전" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sameSchedule(a: LessonTime[], b: LessonTime[]) {
  const key = (s: LessonTime) => `${s.day}|${s.startTime}|${s.endTime}`;
  return [...a].map(key).sort().join(";") === [...b].map(key).sort().join(";");
}

export function analyzeTimetableRows(rows: unknown[][], roster: RosterEntry[]): TimetableImportRow[] {
  const scanEnd = Math.min(rows.length, 30);
  let headerIndex = -1;
  let columns: Record<keyof typeof HEADER_ALIASES, number> | undefined;
  for (let i = 0; i < scanEnd; i++) {
    const cells = (rows[i] ?? []).map(norm);
    const found = {} as Record<keyof typeof HEADER_ALIASES, number>;
    (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).forEach((key) => {
      found[key] = cells.findIndex((cell) => (HEADER_ALIASES[key] as string[]).includes(cell));
    });
    if ((found.name >= 0 || found.studentCode >= 0) && found.day >= 0 && found.start >= 0 && found.end >= 0) {
      headerIndex = i; columns = found; break;
    }
  }
  if (headerIndex < 0 || !columns) throw new Error("학생(또는 학생코드)·요일·시작시간·종료시간 열을 찾지 못했습니다. 첫 30행 안에 열 제목이 있는 엑셀을 선택해 주세요.");

  const byCode = new Map(roster.map((r) => [norm(r.studentCode), r]));
  const byName = new Map<string, RosterEntry[]>();
  roster.forEach((r) => byName.set(norm(r.name), [...(byName.get(norm(r.name)) ?? []), r]));
  const grouped = new Map<string, { entry: RosterEntry; schedule: LessonTime[] }>();
  const problems = new Map<string, TimetableImportRow>();
  for (const row of rows.slice(headerIndex + 1)) {
    const code = columns.studentCode >= 0 ? String(row?.[columns.studentCode] ?? "").trim() : "";
    const name = columns.name >= 0 ? String(row?.[columns.name] ?? "").trim() : "";
    if (!code && !name) continue;
    const codeEntry = code ? byCode.get(norm(code)) : undefined;
    const nameMatches = byName.get(norm(name)) ?? [];
    const entry = codeEntry ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    const ambiguous = !entry && !codeEntry && nameMatches.length > 1;
    const groupKey = entry?.studentCode ?? `row-${problems.size}-${name}`;
    if (!entry || ambiguous) {
      problems.set(groupKey, { studentCode: code, name, status: ambiguous ? "ambiguous" : "invalid", proposed: [], detail: ambiguous ? "동명이인입니다. 학생코드 열을 추가해 주세요." : "명부에서 학생을 찾지 못했습니다." });
      continue;
    }
    const day = DAY_ALIASES[norm(row?.[columns.day])];
    const startTime = parseTime(row?.[columns.start]);
    const endTime = parseTime(row?.[columns.end]);
    if (!day || !startTime || !endTime || startTime >= endTime) {
      problems.set(entry.studentCode, { studentCode: entry.studentCode, name: entry.name, status: "invalid", proposed: [], detail: `요일 또는 시간 형식을 확인하세요. (엑셀: ${String(row?.[columns.day] ?? "")} ${String(row?.[columns.start] ?? "")}–${String(row?.[columns.end] ?? "")})` });
      continue;
    }
    const item = grouped.get(entry.studentCode) ?? { entry, schedule: [] };
    if (!item.schedule.some((s) => s.day === day && s.startTime === startTime && s.endTime === endTime)) item.schedule.push({ day, startTime, endTime });
    grouped.set(entry.studentCode, item);
  }

  const result: TimetableImportRow[] = [];
  for (const { entry, schedule } of grouped.values()) {
    // 학생에게 형식 오류가 하나라도 있으면 일부 요일만 반영하지 않도록 전체 학생을 보류합니다.
    if (problems.has(entry.studentCode)) continue;
    const current = entry.lessonSchedule ?? [];
    const match = sameSchedule(current, schedule);
    result.push({ studentCode: entry.studentCode, name: entry.name, status: match ? "match" : current.length ? "changed" : "new", proposed: schedule, detail: match ? "기존 시간표와 일치" : current.length ? "기존 수업시간과 다릅니다." : "학생 시간표에 등록된 수업시간이 없습니다." });
  }
  result.push(...problems.values());
  const seen = new Set([...grouped.keys(), ...problems.keys()]);
  roster.forEach((entry) => {
    if (!seen.has(entry.studentCode)) result.push({ studentCode: entry.studentCode, name: entry.name, status: "not_in_file", proposed: [], detail: "제출한 엑셀에서 학생을 찾지 못했습니다." });
  });
  const order: TimetableImportRow["status"][] = ["changed", "new", "ambiguous", "invalid", "not_in_file", "match"];
  return result.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name, "ko"));
}

export function scheduleLabel(schedule: LessonTime[]) {
  const days: Record<DayOfWeek, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
  return schedule.map((s) => `${days[s.day]} ${s.startTime}–${s.endTime}`).join(" / ");
}

function excelDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  if (typeof value === "number" && value >= 30000 && value <= 70000) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
  const text = String(value ?? "").trim();
  if (/^\d{5}$/.test(text)) return new Date(Date.UTC(1899, 11, 30) + Number(text) * 86400000);
  const m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function dayKey(date: Date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }

function parseTimeHour(m: RegExpMatchArray): { hour: number; minute: number } {
  const hour = Number(m[2]);
  const minute = m[3] ? Number(m[3]) : m[4] === "반" ? 30 : m[4] ? Number(m[4].replace(/\D/g, "")) : 0;
  return { hour, minute };
}

function resolveHour(hour: number, minute: number, day: DayOfWeek, ampm?: string): number {
  if (ampm === "오전") return (hour === 12 ? 0 : hour) * 60 + minute;
  if (ampm === "오후") return (hour < 12 ? hour + 12 : hour) * 60 + minute;
  if (hour === 24) return minute; // 24:00 → 0:00 next day edge
  if (hour > 12) return hour * 60 + minute;
  if (hour >= 7 && hour <= 11) return (day === "sun" || day === "sat" ? hour : hour + 12) * 60 + minute;
  const base = hour < 7 ? hour + 12 : hour;
  return (base + (base < 12 && base !== 0 ? 12 : 0)) * 60 + minute;
}

export function timeFromCell(text: string, entry: RosterEntry, day: DayOfWeek): { startTime: string; endTime: string } | null {
  const parts = text.split(/(?:--?>|→)/);
  const effective = parts[parts.length - 1] ?? text;
  const primaryTimeText = /혹시/.test(effective) ? effective.split("혹시")[0] : effective;

  // ── 범위 패턴: "5시-6시반", "4시-5시반", "17:00-18:30" 등 ──
  // 하이픈(- / ~)으로 연결된 두 시각 → 첫 번째가 시작, 두 번째가 종료
  const rangeRe = /(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{1,2})|시\s*(반|\d{1,2}\s*분)?)\s*[-~]\s*(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{1,2})|시\s*(반|\d{1,2}\s*분)?)/;
  const rangeMatch = primaryTimeText.match(rangeRe);
  if (rangeMatch) {
    const startH = Number(rangeMatch[2]);
    const startM = rangeMatch[3] ? Number(rangeMatch[3]) : rangeMatch[4] === "반" ? 30 : rangeMatch[4] ? Number(rangeMatch[4].replace(/\D/g, "")) : 0;
    const endH = Number(rangeMatch[6]);
    const endM = rangeMatch[7] ? Number(rangeMatch[7]) : rangeMatch[8] === "반" ? 30 : rangeMatch[8] ? Number(rangeMatch[8].replace(/\D/g, "")) : 0;
    const startMinutes = resolveHour(startH, startM, day, rangeMatch[1]);
    let endMinutes = resolveHour(endH, endM, day, rangeMatch[5]);
    // 종료가 시작보다 작으면 오전/오후 보정 — 예: 11시-12시반(토)
    if (endMinutes <= startMinutes) endMinutes += 12 * 60;
    if (endMinutes > startMinutes && endMinutes - startMinutes <= 240) {
      const format = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      return { startTime: format(startMinutes), endTime: format(endMinutes) };
    }
  }

  // ── 단일 시각 ──
  const matches = [...primaryTimeText.matchAll(/(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{1,2})|시\s*(반|\d{1,2}\s*분)?)/g)];
  const m = matches[matches.length - 1];
  if (!m) return null;
  const { hour, minute } = parseTimeHour(m);
  if (hour > 24 || minute > 59) return null;
  const current = (entry.lessonSchedule ?? []).filter((s) => s.day === day);
  const targetMinute = hour * 60 + minute;
  const matched = current.find((s) => {
    const [h, min] = s.startTime.split(":").map(Number);
    return h * 60 + min === targetMinute || (h % 12) * 60 + min === targetMinute;
  });
  let startMinutes: number;
  if (matched) startMinutes = Number(matched.startTime.slice(0, 2)) * 60 + Number(matched.startTime.slice(3));
  else startMinutes = resolveHour(hour, minute, day, m[1]);
  const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:시간|h\b)/i);
  const minuteDuration = text.match(/(\d{2,3})\s*분/);
  const duration = durationMatch ? Number(durationMatch[1]) * 60 : minuteDuration ? Number(minuteDuration[1]) : matched ? (() => {
    const [eh, em] = matched.endTime.split(":").map(Number); return eh * 60 + em - startMinutes;
  })() : 60;
  if (!Number.isFinite(duration) || duration < 20 || duration > 240) return null;
  const endMinutes = startMinutes + duration;
  const format = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  if (endMinutes > 1440) return null;
  return { startTime: format(startMinutes), endTime: format(endMinutes) };
}

/** Reads the existing calendar-style weekly workbook and resolves its named cells against the current roster. */
export function analyzeTimetableCalendar(rows: unknown[][], roster: RosterEntry[], effectiveFrom = "2026-11-15"): TimetableCalendarWeek[] {
  const headers: { row: number; date: Date }[] = [];
  rows.forEach((row, index) => {
    const dates = Array.from({ length: 7 }, (_, i) => excelDate(row?.[i + 1]));
    if (dates.every((d): d is Date => !!d) && dates.every((d, i) => i === 0 || d.getTime() - dates[i - 1].getTime() === 86400000)) {
      headers.push({ row: index, date: dates[0] });
    }
  });
  const byName = [...roster].sort((a, b) => b.name.length - a.name.length);
  const output: TimetableCalendarWeek[] = [];
  for (let h = 0; h < headers.length; h++) {
    const { row: startRow, date } = headers[h];
    const weekStart = dayKey(date);
    if (weekStart < effectiveFrom) continue;
    const stopRow = headers[h + 1]?.row ?? rows.length;
    const slotMap = new Map<string, TimetableCalendarSlot>();
    let unresolvedCells = 0;
    const uncertainStudentCodes = new Set<string>();
    const unmatchedNameSet = new Set<string>();
    for (let rowIndex = startRow + 1; rowIndex < stopRow; rowIndex++) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
        const text = String(rows[rowIndex]?.[dayIndex + 1] ?? "").trim();
        if (!text) continue;
        const normalizedText = norm(text);
        let matched = byName.filter((entry) => normalizedText.includes(norm(entry.name)));
        if (!matched.length) {
          const timeStart = text.search(/\d{1,2}\s*(?:시|:)/);
          if (timeStart >= 0) {
            const prefix = text.slice(0, timeStart).trim();
            const token = norm(prefix.split(/\s+/).pop());
            if (token.length >= 2) matched = byName.filter((entry) => norm(entry.name).endsWith(token) || norm(entry.name).startsWith(token));
          }
        }
        if (!matched.length) {
          // 이름처럼 보이는 토큰이 있으면 unmatchedNames에 수집
          const timeStart = text.search(/\d{1,2}\s*(?:시|:)/);
          const namePart = timeStart > 0 ? text.slice(0, timeStart).trim() : text.trim();
          const nameToken = namePart.split(/\s+/).pop() ?? "";
          if (nameToken.length >= 2 && !/^[\d:]+$/.test(nameToken) && !/휴강|취소|종료/.test(nameToken)) {
            unmatchedNameSet.add(nameToken);
          }
          continue; // 명부에 없는 일정 메모는 학생 시간표로 가져오지 않습니다.
        }
        const longest = matched[0].name.length;
        const sameLength = matched.filter((entry) => entry.name.length === longest);
        if (sameLength.length !== 1) { unresolvedCells++; sameLength.forEach((entry) => uncertainStudentCodes.add(entry.studentCode)); continue; }
        const studentStatus = sameLength[0].studentStatus ?? "active";
        if (studentStatus === "withdrawn" || studentStatus === "paused") continue;
        if (/휴강|취소/.test(text)) continue;
        // "?" 포함 셀은 미확정 일정이므로 가져오지 않음
        if (/\?/.test(text)) continue;
        const day = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as DayOfWeek[])[dayIndex];
        // "N시종료" 패턴: 해당 학생의 같은 요일 슬롯 종료 시각 갱신
        const endOnlyMatch = text.match(/(오전|오후)?\s*(\d{1,2})\s*(?:시\s*(반|\d{1,2}\s*분)?|:\s*(\d{1,2}))\s*종료/);
        if (endOnlyMatch) {
          const eHour = Number(endOnlyMatch[2]);
          const eMin = endOnlyMatch[3] === "반" ? 30 : endOnlyMatch[3] ? Number(endOnlyMatch[3].replace(/\D/g, "")) : endOnlyMatch[4] ? Number(endOnlyMatch[4]) : 0;
          const endMinutes = resolveHour(eHour, eMin, day, endOnlyMatch[1]);
          const fmt = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
          const endTime = fmt(endMinutes);
          // 같은 요일에 이미 등록된 해당 학생 슬롯을 찾아 종료 시각 갱신
          for (const [k, slot] of slotMap.entries()) {
            if (k.startsWith(`${day}|`) && slot.studentCodes.includes(sameLength[0].studentCode)) {
              const parts = k.split("|");
              const newKey = `${parts[0]}|${parts[1]}|${endTime}`;
              slot.endTime = endTime;
              slotMap.delete(k);
              slotMap.set(newKey, slot);
              break;
            }
          }
          continue;
        }
        const time = timeFromCell(text, sameLength[0], day);
        if (!time) {
          const current = (sameLength[0].lessonSchedule ?? []).filter((s) => s.day === day);
          if (current.length === 1) {
            const key = `${day}|${current[0].startTime}|${current[0].endTime}`;
            const slot = slotMap.get(key) ?? { ...current[0], studentCodes: [] };
            slot.studentCodes.push(sameLength[0].studentCode); slotMap.set(key, slot);
          } else { unresolvedCells++; uncertainStudentCodes.add(sameLength[0].studentCode); }
          continue;
        }
        const key = `${day}|${time.startTime}|${time.endTime}`;
        const slot = slotMap.get(key) ?? { day, ...time, studentCodes: [] };
        if (!slot.studentCodes.includes(sameLength[0].studentCode)) slot.studentCodes.push(sameLength[0].studentCode);
        slotMap.set(key, slot);
      }
    }
    if (slotMap.size || unresolvedCells) output.push({ weekStart, slots: [...slotMap.values()], unresolvedCells, uncertainStudentCodes: [...uncertainStudentCodes], unmatchedNames: [...unmatchedNameSet] });
  }
  return output;
}

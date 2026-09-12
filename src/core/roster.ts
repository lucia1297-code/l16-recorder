import { validatePhoneNumber, normalizePhoneNumber } from "./otpLogic";
import { generateStudentCode } from "./studentCode";

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// 요일별 수업 횟수 (1=일반, 2=연강)
export type LessonDayMap = Partial<Record<DayOfWeek, 1 | 2>>;

// 수업 시간 정보 (시작·종료 시간 포함)
export interface LessonTime {
  day: DayOfWeek;
  startTime: string;  // "HH:MM" (예: "08:30")
  endTime: string;    // "HH:MM" (예: "11:30")
}

// 주간 수업 일정 (최대 5일)
export type LessonSchedule = LessonTime[];

// 총 주간 시수 계산
export function calcWeeklyTotal(lessonDayMap: LessonDayMap | undefined): number {
  if (!lessonDayMap) return 0;
  return Object.values(lessonDayMap).reduce((sum, n) => sum + (n ?? 0), 0);
}

// Date.getDay() 결과(0=일요일)와 순서가 일치한다
const WEEKDAY_ORDER: DayOfWeek[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * 수업 요일(lessonDays)을 기준으로 해당 월의 모든 수업일을
 * status:"normal" ClassSession 으로 생성한다. 이미 existingDates 에 있는 날짜는 건너뛴다.
 */
export function generateSessionsForMonth(
  lessonDayMap: LessonDayMap | undefined,
  year: number,
  month: number, // 1-12
  existingDates: string[] = [],
): ClassSession[] {
  const days = lessonDayMap ?? {};
  const lastDay = new Date(year, month, 0).getDate();
  const sessions: ClassSession[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dow = WEEKDAY_ORDER[new Date(year, month - 1, d).getDay()];
    if ((days[dow] ?? 0) > 0) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!existingDates.includes(date)) {
        sessions.push({ date, status: "normal", makeupDone: false });
      }
    }
  }
  return sessions;
}

export interface ClassSession {
  date: string;           // ISO date (YYYY-MM-DD)
  status: "normal" | "cancelled" | "absent" | "makeup"; // 정상/휴강/결강/보충
  attended?: boolean;     // 실제 수업 진행 여부 (정상 수업일 출석 체크)
  makeupDate?: string;    // 보충 날짜
  makeupDone?: boolean;   // 보충 완료 여부
  note?: string;
}

export type StudentStatus = "active" | "paused" | "withdrawn"; // 수강중/중단/퇴원

export interface ExamSchedule {
  name: string;           // 시험명 (예: "영어", "수학")
  startDate: string;      // 시작일 (YYYY-MM-DD)
  endDate: string;        // 종료일 (YYYY-MM-DD)
  color?: string;         // 표시 색상
}

export interface RosterEntry {
  studentCode: string;
  name: string;
  school: string;
  grade: string;
  phone: string;
  parentPhone?: string;
  teacher: string;
  note: string;
  registeredAt?: string;
  studentType?: "S" | "W2" | "W1" | "";
  excludeFromReminder?: boolean;
  weeklySession?: 1 | 2 | 3 | 4 | 5 | 6 | null;
  lessonDays?: LessonDayMap;
  classSessions?: ClassSession[];
  lastAssignmentSavedAt?: string;
  studentStatus?: StudentStatus;  // 수강 상태 (기본값: active)
  pausedAt?: string;              // 중단 시작일
  pausedReason?: string;          // 중단 사유
  lessonSchedule?: LessonSchedule;  // 수업 시간 일정 (최대 5일)
  examSchedules?: ExamSchedule[];  // 시험 일정
}

// 수업 시수별 과제 제출 기한 (일)
export function getReminderDays(weeklySession: number | null | undefined): number {
  if (weeklySession === 1) return 5;
  if (weeklySession === 2) return 2;
  // 3회 이상은 2일 기준
  if (weeklySession != null && weeklySession >= 3) return 2;
  return 3; // 미설정 기본값
}

export interface ParseRosterResult {
  valid: RosterEntry[];
  errors: string[];
}

const EXAMPLE_NOTE_MARKER = "예시 행";

/**
 * 엑셀에서 읽은 2차원 배열(첫 행 = 헤더)을 검증된 RosterEntry 목록으로 변환한다.
 * 파일 I/O나 SheetJS 의존성이 전혀 없는 순수 함수 — UI 레이어에서 파싱한 결과만 넘겨받는다.
 *
 * 학생코드 열이 비어 있으면 자동으로 생성한다 (S1001, S1002, ... 형식).
 * existingCodes 로 이미 등록된 명부의 코드를 넘기면 그 이후 번호부터 이어서 생성한다.
 */
export function parseRosterRows(
  rows: unknown[][],
  existingCodes: string[] = [],
): ParseRosterResult {
  const valid: RosterEntry[] = [];
  const errors: string[] = [];
  // 코드 생성 시 충돌을 피하기 위한 전체 집합 (기존 등록분 + 이번 파일에서 배정된 코드)
  const codePool = new Set<string>(existingCodes.map((c) => c.trim()));
  // "같은 파일 안에서의 중복"만 오류로 판단 — 기존에 이미 등록된 코드를 재업로드(갱신)하는
  // 것은 정상적인 upsert 이므로 오류가 아니다.
  const fileCodes = new Set<string>();

  const dataRows = rows.slice(1); // 첫 행은 헤더로 간주하고 건너뜀

  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2; // 실제 엑셀 행 번호 (1행=헤더)
    const cells = (row ?? []).map((c) => String(c ?? "").trim());
    const [studentCodeRaw, name, school, grade, phoneRaw, teacher, note, parentPhoneRaw, studentTypeRaw] = [
      cells[0] ?? "",
      cells[1] ?? "",
      cells[2] ?? "",
      cells[3] ?? "",
      cells[4] ?? "",
      cells[5] ?? "",
      cells[6] ?? "",
      cells[7] ?? "",
      cells[8] ?? "",
    ];

    // 완전히 빈 행은 조용히 무시 (학생코드는 자동생성 대상이라 존재 여부 판단에서 제외)
    if (![name, school, grade, phoneRaw].some((v) => v)) return;

    // 템플릿이 넣어준 예시 행은 자동으로 건너뜀
    if (note.includes(EXAMPLE_NOTE_MARKER)) return;

    const rowErrors: string[] = [];
    if (!name) rowErrors.push("이름");
    if (!school) rowErrors.push("학교");
    if (!grade) rowErrors.push("학년");
    const phoneErrs = validatePhoneNumber(phoneRaw);

    if (rowErrors.length > 0) {
      errors.push(`${rowNum}행: ${rowErrors.join(", ")} 값이 비어 있습니다.`);
      return;
    }
    if (phoneErrs.length > 0) {
      errors.push(`${rowNum}행: ${phoneErrs[0]}`);
      return;
    }
    // 학부모 전화번호는 선택 — 입력된 경우에만 형식 검증
    if (parentPhoneRaw && validatePhoneNumber(parentPhoneRaw).length > 0) {
      errors.push(`${rowNum}행: 학부모 ${validatePhoneNumber(parentPhoneRaw)[0]}`);
      return;
    }

    let studentCode = studentCodeRaw;
    if (!studentCode) {
      studentCode = generateStudentCode(codePool);
    } else if (fileCodes.has(studentCode)) {
      errors.push(`${rowNum}행: 학생코드 "${studentCode}" 가 파일 내에서 중복되었습니다.`);
      return;
    }
    fileCodes.add(studentCode);
    codePool.add(studentCode);

    const rawType = (studentTypeRaw ?? "").trim().toUpperCase();
    const studentType = (["S", "W2", "W1"].includes(rawType) ? rawType : "") as "S" | "W2" | "W1" | "";

    valid.push({
      studentCode,
      name,
      school,
      grade,
      phone: normalizePhoneNumber(phoneRaw),
      parentPhone: parentPhoneRaw ? normalizePhoneNumber(parentPhoneRaw) : undefined,
      teacher,
      note,
      studentType,
      excludeFromReminder: false,
    });
  });

  return { valid, errors };
}

export interface ManualEntryInput {
  studentCode?: string;
  name: string;
  school: string;
  grade: string;
  phone: string;
  parentPhone?: string;
  teacher?: string;
}

export interface BuildManualEntryResult {
  entry?: RosterEntry;
  errors: string[];
}

/**
 * 관리자가 명부 관리 화면에서 학생 한 명을 즉시 수동 등록할 때 사용.
 * parseRosterRows 와 동일한 검증/코드생성 규칙을 한 건짜리 입력에 적용한다.
 */
export function buildManualEntry(
  input: ManualEntryInput,
  existingCodes: string[],
): BuildManualEntryResult {
  const errors: string[] = [];
  const name = input.name.trim();
  const school = input.school.trim();
  const grade = input.grade.trim();
  const teacher = (input.teacher ?? "").trim();
  const studentCodeRaw = (input.studentCode ?? "").trim();
  const parentPhoneRaw = (input.parentPhone ?? "").trim();

  const missing: string[] = [];
  if (!name) missing.push("이름");
  if (!school) missing.push("학교");
  if (!grade) missing.push("학년");
  if (missing.length > 0) {
    errors.push(`${missing.join(", ")} 값이 비어 있습니다.`);
    return { errors };
  }

  const phoneErrs = validatePhoneNumber(input.phone);
  if (phoneErrs.length > 0) {
    errors.push(phoneErrs[0]);
    return { errors };
  }
  if (parentPhoneRaw && validatePhoneNumber(parentPhoneRaw).length > 0) {
    errors.push(`학부모 ${validatePhoneNumber(parentPhoneRaw)[0]}`);
    return { errors };
  }

  const codePool = new Set(existingCodes.map((c) => c.trim()));
  let studentCode = studentCodeRaw;
  if (!studentCode) {
    studentCode = generateStudentCode(codePool);
  } else if (codePool.has(studentCode)) {
    errors.push(`학생코드 "${studentCode}" 가 이미 등록된 코드와 중복됩니다.`);
    return { errors };
  }

  return {
    entry: {
      studentCode,
      name,
      school,
      grade,
      phone: normalizePhoneNumber(input.phone),
      parentPhone: parentPhoneRaw ? normalizePhoneNumber(parentPhoneRaw) : undefined,
      teacher,
      note: "관리자 직접 등록",
    },
    errors: [],
  };
}

// ── 월별 정산 계산 ──────────────────────────────────

const DAY_NAMES: DayOfWeek[] = ["sun","mon","tue","wed","thu","fri","sat"];

export interface MonthlySettlement {
  studentCode: string;
  name: string;
  year: number;
  month: number;
  possibleCount: number;  // 총 가능 수업수 (요일 기준)
  actualCount: number;    // 실제 수업수 (정상 + 보충완료)
  makeupCount: number;    // 보충 수업수
  cancelledCount: number; // 휴강수
  absentCount: number;    // 결강수
  uncheckedCount: number; // 출석 미확인수
}

export function calcMonthlySettlement(
  entry: RosterEntry,
  year: number,
  month: number
): MonthlySettlement {
  const lessonDays = entry.lessonDays ?? {};
  const sessions = (entry.classSessions ?? []).filter((s) => {
    const d = new Date(s.date);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });

  // 해당 월의 가능 수업일 계산
  const daysInMonth = new Date(year, month, 0).getDate();
  let possibleCount = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = DAY_NAMES[new Date(year, month - 1, d).getDay()];
    possibleCount += lessonDays[dow] ?? 0;
  }

  // 세션별 집계
  const sessionMap = new Map(sessions.map((s) => [s.date, s]));
  let cancelledCount = 0;
  let absentCount = 0;
  let makeupCount = 0;
  let attendedCount = 0;
  let uncheckedCount = 0;

  // 정상 수업일 순회
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = DAY_NAMES[new Date(year, month - 1, d).getDay()];
    const times = lessonDays[dow] ?? 0;
    if (times === 0) continue;

    const session = sessionMap.get(dateStr);
    if (!session) {
      // 이력 없음 → 미확인
      uncheckedCount += times;
    } else if (session.status === "cancelled") {
      cancelledCount += times;
      if (session.makeupDone) makeupCount += times;
    } else if (session.status === "absent") {
      absentCount += times;
    } else if (session.status === "normal") {
      if (session.attended === false) absentCount += times;
      else if (session.attended === true) attendedCount += times;
      else uncheckedCount += times;
    } else if (session.status === "makeup") {
      makeupCount += times;
    }
  }

  // 보충 수업 (보충일이 이 달에 있는 경우)
  const extraMakeup = sessions.filter((s) =>
    s.status === "makeup" &&
    (() => { const d = new Date(s.date); return d.getFullYear() === year && d.getMonth() + 1 === month; })()
  ).length;

  const actualCount = attendedCount + makeupCount;

  return {
    studentCode: entry.studentCode,
    name: entry.name,
    year, month,
    possibleCount,
    actualCount,
    makeupCount,
    cancelledCount,
    absentCount,
    uncheckedCount,
  };
}

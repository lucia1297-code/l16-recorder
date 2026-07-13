import { validatePhoneNumber, normalizePhoneNumber } from "./otpLogic";

export interface RosterEntry {
  studentCode: string;
  name: string;
  school: string;
  grade: string;
  phone: string; // normalized digits only
  teacher: string;
  note: string;
}

export interface ParseRosterResult {
  valid: RosterEntry[];
  errors: string[];
}

const EXAMPLE_NOTE_MARKER = "예시 행";

/**
 * 엑셀에서 읽은 2차원 배열(첫 행 = 헤더)을 검증된 RosterEntry 목록으로 변환한다.
 * 파일 I/O나 SheetJS 의존성이 전혀 없는 순수 함수 — UI 레이어에서 파싱한 결과만 넘겨받는다.
 */
export function parseRosterRows(rows: unknown[][]): ParseRosterResult {
  const valid: RosterEntry[] = [];
  const errors: string[] = [];
  const seenCodes = new Set<string>();

  const dataRows = rows.slice(1); // 첫 행은 헤더로 간주하고 건너뜀

  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2; // 실제 엑셀 행 번호 (1행=헤더)
    const cells = (row ?? []).map((c) => String(c ?? "").trim());
    const [studentCode, name, school, grade, phoneRaw, teacher, note] = [
      cells[0] ?? "",
      cells[1] ?? "",
      cells[2] ?? "",
      cells[3] ?? "",
      cells[4] ?? "",
      cells[5] ?? "",
      cells[6] ?? "",
    ];

    // 완전히 빈 행은 조용히 무시
    if (![studentCode, name, school, grade, phoneRaw].some((v) => v)) return;

    // 템플릿이 넣어준 예시 행은 자동으로 건너뜀
    if (note.includes(EXAMPLE_NOTE_MARKER)) return;

    const rowErrors: string[] = [];
    if (!studentCode) rowErrors.push("학생코드");
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

    if (seenCodes.has(studentCode)) {
      errors.push(`${rowNum}행: 학생코드 "${studentCode}" 가 중복되었습니다.`);
      return;
    }
    seenCodes.add(studentCode);

    valid.push({
      studentCode,
      name,
      school,
      grade,
      phone: normalizePhoneNumber(phoneRaw),
      teacher,
      note,
    });
  });

  return { valid, errors };
}

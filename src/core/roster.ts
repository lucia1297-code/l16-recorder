import { validatePhoneNumber, normalizePhoneNumber } from "./otpLogic";
import { generateStudentCode } from "./studentCode";

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
    const [studentCodeRaw, name, school, grade, phoneRaw, teacher, note] = [
      cells[0] ?? "",
      cells[1] ?? "",
      cells[2] ?? "",
      cells[3] ?? "",
      cells[4] ?? "",
      cells[5] ?? "",
      cells[6] ?? "",
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

    let studentCode = studentCodeRaw;
    if (!studentCode) {
      studentCode = generateStudentCode(codePool);
    } else if (fileCodes.has(studentCode)) {
      errors.push(`${rowNum}행: 학생코드 "${studentCode}" 가 파일 내에서 중복되었습니다.`);
      return;
    }
    fileCodes.add(studentCode);
    codePool.add(studentCode);

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

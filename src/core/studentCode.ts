const CODE_RE = /^S(\d+)$/i;
const START = 1001;

/**
 * 기존 학생코드 목록을 보고 다음 코드를 "S1001" 형식으로 생성한다.
 * S로 시작하고 숫자로 끝나는 코드만 인식하며, 그중 최댓값+1을 사용한다.
 * 기존 코드가 하나도 없으면 S1001 부터 시작한다.
 */
export function generateStudentCode(existingCodes: Iterable<string>): string {
  let max = START - 1;
  for (const code of existingCodes) {
    const m = CODE_RE.exec(code.trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  const next = max + 1;
  const digits = Math.max(4, String(next).length);
  return "S" + String(next).padStart(digits, "0");
}

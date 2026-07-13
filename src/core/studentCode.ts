// 0, 1, I, O, L 제외 — 학생이 문자로 받아 직접 타이핑할 때 헷갈리기 쉬운 문자를 뺐다.
export const CODE_CHARSET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;

/**
 * 무작위 8자리 영숫자 코드를 생성한다 (암호처럼 보이는, 순번이 아닌 코드).
 */
export function generateRandomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const idx = Math.floor(Math.random() * CODE_CHARSET.length);
    code += CODE_CHARSET[idx];
  }
  return code;
}

/**
 * 기존 학생코드 목록과 겹치지 않는 무작위 8자리 코드를 생성한다.
 * codeGenerator 를 주입하면 테스트에서 결정적으로 검증할 수 있다.
 */
export function generateStudentCode(
  existingCodes: Iterable<string>,
  codeGenerator: () => string = generateRandomCode,
): string {
  const existing = new Set(Array.from(existingCodes, (c) => c.trim().toUpperCase()));
  let code = codeGenerator();
  let attempts = 0;
  while (existing.has(code.toUpperCase()) && attempts < 1000) {
    code = codeGenerator();
    attempts++;
  }
  return code;
}

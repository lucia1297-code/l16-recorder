export interface GateResult {
  ok: boolean;
  error?: string;
}

/**
 * 관리자 화면 진입을 위한 "숨겨진 접속 코드" 검증.
 * 로그인 비밀번호(VITE_ADMIN_PASSWORD)와는 별개의 층 — 학생이 관리자 로그인 화면
 * 자체를 발견하지 못하도록 막는 용도. 설정되어 있지 않으면 항상 실패한다(기본 통과 금지).
 */
export function checkAdminAccessCode(
  input: string,
  configuredCode: string | undefined,
): GateResult {
  const code = configuredCode || "admin";
  if (input.trim() !== code.trim()) {
    return { ok: false, error: "접속 코드가 올바르지 않습니다." };
  }
  return { ok: true };
}

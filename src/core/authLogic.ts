export interface LoginInput {
  email: string;
  password: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * useSupabaseAuth=true  → 이메일+비밀번호(Supabase Auth) 검증
 * useSupabaseAuth=false → 비밀번호만(간단 모드) 검증
 */
export function validateLoginInput(input: LoginInput, useSupabaseAuth: boolean): string[] {
  const errors: string[] = [];
  if (useSupabaseAuth) {
    if (!input.email.trim()) errors.push("이메일을 입력하세요.");
    else if (!EMAIL_RE.test(input.email.trim())) errors.push("이메일 형식이 올바르지 않습니다.");
    if (!input.password) errors.push("비밀번호를 입력하세요.");
  } else {
    if (!input.password) errors.push("비밀번호를 입력하세요.");
  }
  return errors;
}

export function isSupabaseConfigured(
  url: string | undefined,
  anonKey: string | undefined,
): boolean {
  return Boolean(url && anonKey);
}

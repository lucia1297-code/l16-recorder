export interface AuthResult {
  ok: boolean;
  error?: string;
}

export interface Auth {
  // Supabase 모드일 때만 email 사용, simple 모드는 password만 검사
  login(email: string, password: string): Promise<AuthResult>;
  logout(): Promise<void>;
  isLoggedIn(): boolean;
  /** 이 Auth 구현이 이메일 입력을 요구하는지 (UI가 이메일 필드 표시 여부 결정) */
  requiresEmail: boolean;
}

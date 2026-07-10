import type { Auth, AuthResult } from "./auth";

const SESSION_KEY = "asx.admin.session";

// 비밀번호는 하드코딩하지 않고 .env 의 VITE_ADMIN_PASSWORD 사용.
// 설정하지 않으면 개발용 기본값 사용 (README/콘솔에 경고).
const DEFAULT_DEV_PASSWORD = "asx2026";

export class SimpleAuth implements Auth {
  requiresEmail = false;

  private getPassword(): string {
    const envPw = import.meta.env.VITE_ADMIN_PASSWORD as string | undefined;
    if (!envPw) {
      // eslint-disable-next-line no-console
      console.warn(
        "[ASX] VITE_ADMIN_PASSWORD가 설정되지 않아 개발용 기본 비밀번호를 사용합니다. " +
          ".env 에 VITE_ADMIN_PASSWORD를 설정하세요.",
      );
      return DEFAULT_DEV_PASSWORD;
    }
    return envPw;
  }

  async login(_email: string, password: string): Promise<AuthResult> {
    if (password === this.getPassword()) {
      sessionStorage.setItem(SESSION_KEY, "1");
      return { ok: true };
    }
    return { ok: false, error: "비밀번호가 틀립니다." };
  }

  async logout(): Promise<void> {
    sessionStorage.removeItem(SESSION_KEY);
  }

  isLoggedIn(): boolean {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  }
}

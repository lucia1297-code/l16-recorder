import type { SmsProvider } from "./sms";
import {
  createOtpSession,
  verifyOtpCode,
  validatePhoneNumber,
  normalizePhoneNumber,
  type OtpSession,
} from "../core/otpLogic";

const SESSION_PREFIX = "asx.otp.session.";
const VERIFIED_PREFIX = "asx.otp.verified.";

export interface OtpActionResult {
  ok: boolean;
  error?: string;
}

/**
 * ⚠️ 이 구현은 인증번호 세션을 브라우저 localStorage 에 저장합니다 (MVP 데모 수준).
 * 즉, 브라우저 개발자도구를 열면 인증번호를 확인할 수 있어 완전한 보안은 아닙니다.
 * 운영 배포 전에는 세션 검증을 서버(Supabase Edge Function)로 옮기는 것을 권장합니다.
 * 템플릿: supabase/functions/verify-otp/index.ts
 */
export class OtpService {
  constructor(private sms: SmsProvider) {}

  private sessionKey(phone: string) {
    return SESSION_PREFIX + normalizePhoneNumber(phone);
  }
  private verifiedKey(phone: string) {
    return VERIFIED_PREFIX + normalizePhoneNumber(phone);
  }

  private loadSession(phone: string): OtpSession | null {
    const raw = localStorage.getItem(this.sessionKey(phone));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OtpSession;
    } catch {
      return null;
    }
  }

  private saveSession(session: OtpSession) {
    localStorage.setItem(this.sessionKey(session.phone), JSON.stringify(session));
  }

  async requestOtp(phone: string): Promise<OtpActionResult> {
    const errs = validatePhoneNumber(phone);
    if (errs.length) return { ok: false, error: errs[0] };

    const session = createOtpSession(phone, new Date());
    this.saveSession(session);
    localStorage.removeItem(this.verifiedKey(phone));
    sessionStorage.removeItem(this.verifiedKey(phone));

    try {
      await this.sms.send(
        session.phone,
        `인증번호: ${session.code} (5분 이내 입력)`,
      );
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: true };
  }

  async verifyOtp(phone: string, code: string): Promise<OtpActionResult> {
    const session = this.loadSession(phone);
    if (!session) {
      return { ok: false, error: "먼저 인증번호를 요청하세요." };
    }
    const result = verifyOtpCode(session, code, new Date());
    this.saveSession(result.session);
    if (result.ok) {
      // sessionStorage: 탭/창 닫으면 자동 삭제 → 재접속 시 반드시 재인증
      sessionStorage.setItem(this.verifiedKey(phone), "1");
      // localStorage의 이전 인증 기록 제거
      localStorage.removeItem(this.verifiedKey(phone));
    sessionStorage.removeItem(this.verifiedKey(phone));
    }
    return { ok: result.ok, error: result.error };
  }

  isVerified(phone: string): boolean {
    // localStorage 이전 기록도 제거 (마이그레이션)
    localStorage.removeItem(this.verifiedKey(phone));
    sessionStorage.removeItem(this.verifiedKey(phone));
    return sessionStorage.getItem(this.verifiedKey(phone)) === "1";
  }
}

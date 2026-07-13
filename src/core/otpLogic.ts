export interface OtpSession {
  phone: string;
  code: string;
  createdAt: number; // epoch ms
  attempts: number;
}

export interface OtpVerifyResult {
  ok: boolean;
  error?: string;
  session: OtpSession;
}

export const OTP_TTL_MS = 5 * 60 * 1000; // 5분
export const OTP_MAX_ATTEMPTS = 5;

// 한국 휴대폰 번호만 허용 (010/011/016/017/018/019 로 시작하는 10~11자리)
const MOBILE_RE = /^01[016789]\d{7,8}$/;

export function normalizePhoneNumber(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

export function validatePhoneNumber(input: string): string[] {
  const errors: string[] = [];
  const digits = normalizePhoneNumber(input);
  if (!digits) {
    errors.push("전화번호를 입력하세요.");
    return errors;
  }
  if (!MOBILE_RE.test(digits)) {
    errors.push("휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)");
  }
  return errors;
}

export function generateOtpCode(): string {
  // 000000~999999, 앞자리 0 유지
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, "0");
}

export function createOtpSession(
  phone: string,
  now: Date,
  codeGenerator: () => string = generateOtpCode,
): OtpSession {
  return {
    phone: normalizePhoneNumber(phone),
    code: codeGenerator(),
    createdAt: now.getTime(),
    attempts: 0,
  };
}

export function verifyOtpCode(
  session: OtpSession,
  inputCode: string,
  now: Date,
): OtpVerifyResult {
  if (session.attempts >= OTP_MAX_ATTEMPTS) {
    return {
      ok: false,
      error: "인증 시도 횟수를 초과했습니다. 새 인증번호를 요청하세요.",
      session,
    };
  }
  const expired = now.getTime() - session.createdAt > OTP_TTL_MS;
  if (expired) {
    return { ok: false, error: "인증번호가 만료되었습니다. 다시 요청하세요.", session };
  }
  if (inputCode.trim() !== session.code) {
    const next = { ...session, attempts: session.attempts + 1 };
    return { ok: false, error: "인증번호가 일치하지 않습니다.", session: next };
  }
  return { ok: true, session };
}

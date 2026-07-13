import { describe, it, expect } from "vitest";
import {
  validatePhoneNumber,
  normalizePhoneNumber,
  generateOtpCode,
  createOtpSession,
  verifyOtpCode,
  OTP_TTL_MS,
  OTP_MAX_ATTEMPTS,
} from "../core/otpLogic";

describe("validatePhoneNumber", () => {
  it("accepts valid Korean mobile formats", () => {
    expect(validatePhoneNumber("010-1234-5678").length).toBe(0);
    expect(validatePhoneNumber("01012345678").length).toBe(0);
    expect(validatePhoneNumber("011-123-4567").length).toBe(0);
  });
  it("rejects invalid formats", () => {
    expect(validatePhoneNumber("").length).toBeGreaterThan(0);
    expect(validatePhoneNumber("123").length).toBeGreaterThan(0);
    expect(validatePhoneNumber("02-1234-5678").length).toBeGreaterThan(0); // 유선전화
  });
});

describe("normalizePhoneNumber", () => {
  it("strips dashes/spaces to digits only", () => {
    expect(normalizePhoneNumber("010-1234-5678")).toBe("01012345678");
    expect(normalizePhoneNumber("010 1234 5678")).toBe("01012345678");
  });
});

describe("generateOtpCode", () => {
  it("generates a 6-digit numeric string", () => {
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });
  it("generates different codes across many calls (not constant)", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("createOtpSession / verifyOtpCode", () => {
  const now = new Date("2026-07-13T10:00:00.000Z");

  it("verifies a correct code within TTL", () => {
    const session = createOtpSession("01012345678", now, () => "123456");
    const result = verifyOtpCode(session, "123456", new Date(now.getTime() + 1000));
    expect(result.ok).toBe(true);
  });

  it("rejects an incorrect code and increments attempts", () => {
    const session = createOtpSession("01012345678", now, () => "123456");
    const result = verifyOtpCode(session, "000000", now);
    expect(result.ok).toBe(false);
    expect(result.session.attempts).toBe(1);
  });

  it("rejects after expiry (TTL)", () => {
    const session = createOtpSession("01012345678", now, () => "123456");
    const later = new Date(now.getTime() + OTP_TTL_MS + 1000);
    const result = verifyOtpCode(session, "123456", later);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/만료/);
  });

  it("locks out after max attempts", () => {
    let session = createOtpSession("01012345678", now, () => "123456");
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      const r = verifyOtpCode(session, "000000", now);
      session = r.session;
    }
    const final = verifyOtpCode(session, "123456", now); // even correct code, locked out
    expect(final.ok).toBe(false);
    expect(final.error).toMatch(/횟수/);
  });
});

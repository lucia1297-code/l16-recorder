import { describe, it, expect, beforeEach, vi } from "vitest";
import { OtpService } from "../lib/otpService";
import type { SmsProvider } from "../lib/sms";

class FakeSms implements SmsProvider {
  sent: { phone: string; message: string }[] = [];
  async send(phone: string, message: string) {
    this.sent.push({ phone, message });
  }
}

describe("OtpService", () => {
  let sms: FakeSms;
  let service: OtpService;

  beforeEach(() => {
    localStorage.clear();
    sms = new FakeSms();
    service = new OtpService(sms);
  });

  it("rejects an invalid phone number without sending", async () => {
    const r = await service.requestOtp("123");
    expect(r.ok).toBe(false);
    expect(sms.sent.length).toBe(0);
  });

  it("sends an OTP for a valid phone number", async () => {
    const r = await service.requestOtp("010-1234-5678");
    expect(r.ok).toBe(true);
    expect(sms.sent.length).toBe(1);
    expect(sms.sent[0].phone).toBe("01012345678");
    expect(sms.sent[0].message).toMatch(/\d{6}/);
  });

  it("verifies the correct code sent", async () => {
    await service.requestOtp("010-1234-5678");
    const sentMsg = sms.sent[0].message;
    const code = sentMsg.match(/\d{6}/)![0];
    const result = await service.verifyOtp("010-1234-5678", code);
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong code", async () => {
    await service.requestOtp("010-1234-5678");
    const result = await service.verifyOtp("010-1234-5678", "000000");
    expect(result.ok).toBe(false);
  });

  it("rejects verify when no OTP was requested", async () => {
    const result = await service.verifyOtp("010-9999-9999", "123456");
    expect(result.ok).toBe(false);
  });

  it("marks phone as verified after success, isVerified reflects it", async () => {
    await service.requestOtp("010-1234-5678");
    const sentMsg = sms.sent[0].message;
    const code = sentMsg.match(/\d{6}/)![0];
    expect(service.isVerified("010-1234-5678")).toBe(false);
    await service.verifyOtp("010-1234-5678", code);
    expect(service.isVerified("010-1234-5678")).toBe(true);
  });
});

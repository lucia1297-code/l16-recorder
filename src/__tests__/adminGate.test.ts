import { describe, it, expect } from "vitest";
import { checkAdminAccessCode } from "../core/adminGate";

describe("checkAdminAccessCode", () => {
  it("accepts a code matching the configured value", () => {
    expect(checkAdminAccessCode("1234", "1234").ok).toBe(true);
  });

  it("rejects a non-matching code", () => {
    expect(checkAdminAccessCode("0000", "1234").ok).toBe(false);
  });

  it("rejects when no code has been configured at all", () => {
    // 관리자가 접속 코드를 설정하지 않았으면 아무도 들어갈 수 없어야 한다 (기본값 없음)
    expect(checkAdminAccessCode("anything", undefined).ok).toBe(false);
    expect(checkAdminAccessCode("anything", "").ok).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    expect(checkAdminAccessCode("  1234  ", "1234").ok).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { validateLoginInput, isSupabaseConfigured } from "../core/authLogic";

describe("validateLoginInput", () => {
  it("requires email and password when using Supabase auth", () => {
    expect(validateLoginInput({ email: "", password: "x" }, true).length).toBeGreaterThan(0);
    expect(validateLoginInput({ email: "a@b.com", password: "" }, true).length).toBeGreaterThan(0);
    expect(validateLoginInput({ email: "a@b.com", password: "123456" }, true).length).toBe(0);
  });

  it("rejects malformed email", () => {
    expect(validateLoginInput({ email: "not-an-email", password: "123456" }, true).length).toBeGreaterThan(0);
  });

  it("only requires password (not email) for simple mode", () => {
    expect(validateLoginInput({ email: "", password: "" }, false).length).toBeGreaterThan(0);
    expect(validateLoginInput({ email: "", password: "asx2026" }, false).length).toBe(0);
  });
});

describe("isSupabaseConfigured", () => {
  it("returns false when url or key missing", () => {
    expect(isSupabaseConfigured(undefined, undefined)).toBe(false);
    expect(isSupabaseConfigured("https://x.supabase.co", undefined)).toBe(false);
  });
  it("returns true when both present", () => {
    expect(isSupabaseConfigured("https://x.supabase.co", "key123")).toBe(true);
  });
});

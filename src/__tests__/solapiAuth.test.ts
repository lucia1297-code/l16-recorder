import { describe, it, expect } from "vitest";
import { hmacSha256Hex, randomHex } from "../lib/solapiAuth";

describe("hmacSha256Hex", () => {
  it("matches a known HMAC-SHA256 test vector", async () => {
    const sig = await hmacSha256Hex("testsecret", "2019-07-01T00:41:48Zjqsba2jxjnrjor");
    expect(sig).toBe("777acf09ed8fa7964f5fc2a763868338c95e66eb968a07a80b4236759c0df923");
  });

  it("produces a 64-character hex string in general", async () => {
    const sig = await hmacSha256Hex("anysecret", "anymessage");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different signatures for different messages", async () => {
    const a = await hmacSha256Hex("secret", "message-a");
    const b = await hmacSha256Hex("secret", "message-b");
    expect(a).not.toBe(b);
  });
});

describe("randomHex", () => {
  it("generates a hex string of the requested length", () => {
    expect(randomHex(32)).toHaveLength(32);
    expect(randomHex(16)).toHaveLength(16);
  });

  it("only contains hex characters", () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates different values across calls", () => {
    const values = new Set(Array.from({ length: 20 }, () => randomHex(32)));
    expect(values.size).toBeGreaterThan(1);
  });
});

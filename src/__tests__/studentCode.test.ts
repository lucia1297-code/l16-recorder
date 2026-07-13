import { describe, it, expect } from "vitest";
import { generateStudentCode, generateRandomCode, CODE_CHARSET, CODE_LENGTH } from "../core/studentCode";

const CODE_RE = new RegExp(`^[${CODE_CHARSET}]{${CODE_LENGTH}}$`);

describe("generateRandomCode", () => {
  it("generates an 8-character code using only the allowed charset", () => {
    const code = generateRandomCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(CODE_RE);
  });

  it("excludes visually confusing characters (0, 1, I, O, L)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRandomCode();
      expect(code).not.toMatch(/[01IOL]/);
    }
  });

  it("produces different codes across many calls (not constant)", () => {
    const codes = new Set(Array.from({ length: 30 }, () => generateRandomCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("generateStudentCode", () => {
  it("returns an 8-character code from the allowed charset when no codes exist", () => {
    const code = generateStudentCode([]);
    expect(code).toMatch(CODE_RE);
  });

  it("never returns a code already in the existing set", () => {
    const existing = Array.from({ length: 20 }, () => generateRandomCode());
    const next = generateStudentCode(existing);
    expect(existing).not.toContain(next);
  });

  it("retries when the generator produces a duplicate first (injectable generator)", () => {
    const sequence = ["AAAAAAAA", "AAAAAAAA", "BCDEFGHJ"];
    let i = 0;
    const gen = () => sequence[i++];
    const result = generateStudentCode(["AAAAAAAA"], gen);
    expect(result).toBe("BCDEFGHJ");
  });

  it("treats existing codes as case-insensitive when checking collisions", () => {
    const sequence = ["abcdefgh", "zzzzzzz9"];
    let i = 0;
    const gen = () => sequence[i++];
    const result = generateStudentCode(["ABCDEFGH"], gen);
    expect(result).toBe("zzzzzzz9");
  });
});

import { describe, it, expect } from "vitest";
import { generateStudentCode } from "../core/studentCode";

describe("generateStudentCode", () => {
  it("starts at S1001 when there are no existing codes", () => {
    expect(generateStudentCode([])).toBe("S1001");
  });

  it("continues from the highest existing numeric suffix", () => {
    expect(generateStudentCode(["S1001", "S1002", "S1005"])).toBe("S1006");
  });

  it("ignores codes that don't match the S#### pattern", () => {
    expect(generateStudentCode(["ABC", "S1010", "hello"])).toBe("S1011");
  });

  it("is case-insensitive when scanning existing codes", () => {
    expect(generateStudentCode(["s1099"])).toBe("S1100");
  });

  it("never collides with a code already in the existing set", () => {
    const existing = ["S1001", "S1002", "S1003"];
    const next = generateStudentCode(existing);
    expect(existing).not.toContain(next);
  });

  it("pads to at least 4 digits even past 9999", () => {
    expect(generateStudentCode(["S9999"])).toBe("S10000");
  });
});

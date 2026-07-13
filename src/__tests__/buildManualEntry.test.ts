import { describe, it, expect } from "vitest";
import { buildManualEntry } from "../core/roster";

describe("buildManualEntry", () => {
  it("builds a valid entry with an explicit student code", () => {
    const { entry, errors } = buildManualEntry(
      { studentCode: "S2001", name: "홍길동", school: "창동고", grade: "3", phone: "010-1234-5678", teacher: "김민수" },
      [],
    );
    expect(errors.length).toBe(0);
    expect(entry).toMatchObject({
      studentCode: "S2001",
      name: "홍길동",
      school: "창동고",
      grade: "3",
      phone: "01012345678",
      teacher: "김민수",
    });
  });

  it("auto-generates a student code when left blank", () => {
    const { entry, errors } = buildManualEntry(
      { studentCode: "", name: "김서연", school: "서초고", grade: "2", phone: "010-2222-3333", teacher: "" },
      ["S1005"],
    );
    expect(errors.length).toBe(0);
    expect(entry?.studentCode).toBe("S1006");
  });

  it("rejects when required fields are missing", () => {
    const { entry, errors } = buildManualEntry(
      { studentCode: "", name: "", school: "창동고", grade: "3", phone: "010-1234-5678", teacher: "" },
      [],
    );
    expect(entry).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an invalid phone number", () => {
    const { entry, errors } = buildManualEntry(
      { studentCode: "", name: "홍길동", school: "창동고", grade: "3", phone: "123", teacher: "" },
      [],
    );
    expect(entry).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects an explicit student code that already exists", () => {
    const { entry, errors } = buildManualEntry(
      { studentCode: "S1005", name: "홍길동", school: "창동고", grade: "3", phone: "010-1234-5678", teacher: "" },
      ["S1005"],
    );
    expect(entry).toBeUndefined();
    expect(errors.some((e) => e.includes("중복"))).toBe(true);
  });
});

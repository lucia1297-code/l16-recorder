import { describe, it, expect } from "vitest";
import { parseRosterRows, type RosterEntry } from "../core/roster";

// 시트에서 읽은 2차원 배열 형태를 그대로 흉내낸다: 첫 행은 헤더, 이후 행은 데이터.
const HEADER = ["학생코드", "이름", "학교", "학년", "휴대폰번호", "담당교사", "비고"];

describe("parseRosterRows", () => {
  it("parses valid rows into RosterEntry list", () => {
    const rows = [
      HEADER,
      ["S1023", "홍길동", "창동고", "3", "010-1234-5678", "김민수", ""],
      ["S1024", "김서연", "서초고", "2", "010-2222-3333", "김민수", ""],
    ];
    const { valid, errors } = parseRosterRows(rows);
    expect(errors.length).toBe(0);
    expect(valid.length).toBe(2);
    expect(valid[0]).toMatchObject({
      studentCode: "S1023",
      name: "홍길동",
      school: "창동고",
      grade: "3",
      phone: "01012345678",
    } as Partial<RosterEntry>);
  });

  it("auto-generates a student code when the column is left blank", () => {
    const rows = [HEADER, ["", "홍길동", "창동고", "3", "010-1234-5678", "", ""]];
    const { valid, errors } = parseRosterRows(rows);
    expect(errors.length).toBe(0);
    expect(valid.length).toBe(1);
    expect(valid[0].studentCode).toMatch(/^S\d{4,}$/);
  });

  it("auto-generated codes continue from existing codes and never collide within the file", () => {
    const rows = [
      HEADER,
      ["S1005", "기존학생", "창동고", "3", "010-0000-0001", "", ""],
      ["", "새학생1", "창동고", "3", "010-0000-0002", "", ""],
      ["", "새학생2", "창동고", "3", "010-0000-0003", "", ""],
    ];
    const { valid, errors } = parseRosterRows(rows, ["S1005"]);
    expect(errors.length).toBe(0);
    expect(valid.length).toBe(3);
    const codes = valid.map((v) => v.studentCode);
    expect(new Set(codes).size).toBe(3); // 전부 고유
    expect(codes).toContain("S1005");
    expect(codes).toContain("S1006");
    expect(codes).toContain("S1007");
  });

  it("does not overwrite an explicitly given student code", () => {
    const rows = [HEADER, ["CUSTOM01", "홍길동", "창동고", "3", "010-1234-5678", "", ""]];
    const { valid } = parseRosterRows(rows);
    expect(valid[0].studentCode).toBe("CUSTOM01");
  });

  it("skips the example/instruction row commonly left in by users", () => {
    const rows = [
      HEADER,
      ["S1023", "홍길동", "창동고", "3", "010-1234-5678", "김민수", "예시 행 — 업로드 전 삭제"],
      ["S1024", "김서연", "서초고", "2", "010-2222-3333", "김민수", ""],
    ];
    const { valid } = parseRosterRows(rows);
    expect(valid.length).toBe(1);
    expect(valid[0].studentCode).toBe("S1024");
  });

  it("collects row-level errors for missing required fields (name/school/grade still required)", () => {
    const rows = [
      HEADER,
      ["S9001", "", "창동고", "3", "010-1234-5678", "", ""], // 이름 없음 -> 오류
      ["S1024", "김서연", "", "2", "010-2222-3333", "", ""], // 학교 없음 -> 오류
    ];
    const { valid, errors } = parseRosterRows(rows);
    expect(valid.length).toBe(0);
    expect(errors.length).toBe(2);
    expect(errors[0]).toMatch(/2행/);
  });

  it("collects errors for invalid phone numbers", () => {
    const rows = [HEADER, ["S1023", "홍길동", "창동고", "3", "123", "", ""]];
    const { valid, errors } = parseRosterRows(rows);
    expect(valid.length).toBe(0);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/전화번호|형식/);
  });

  it("rejects duplicate student codes within the same file", () => {
    const rows = [
      HEADER,
      ["S1023", "홍길동", "창동고", "3", "010-1234-5678", "", ""],
      ["S1023", "김서연", "서초고", "2", "010-2222-3333", "", ""],
    ];
    const { valid, errors } = parseRosterRows(rows);
    expect(valid.length).toBe(1);
    expect(errors.some((e) => e.includes("중복"))).toBe(true);
  });

  it("ignores fully blank rows", () => {
    const rows = [
      HEADER,
      ["S1023", "홍길동", "창동고", "3", "010-1234-5678", "", ""],
      ["", "", "", "", "", "", ""],
      [],
    ];
    const { valid, errors } = parseRosterRows(rows);
    expect(valid.length).toBe(1);
    expect(errors.length).toBe(0);
  });

  it("handles an empty sheet (header only)", () => {
    const { valid, errors } = parseRosterRows([HEADER]);
    expect(valid.length).toBe(0);
    expect(errors.length).toBe(0);
  });
});

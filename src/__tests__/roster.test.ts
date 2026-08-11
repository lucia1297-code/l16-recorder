import { describe, it, expect } from "vitest";
import { parseRosterRows, generateSessionsForMonth, type RosterEntry } from "../core/roster";

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
    expect(valid[0].studentCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  });

  it("auto-generated codes never collide with existing or each other within the file", () => {
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
    expect(codes).toContain("S1005"); // 명시적으로 지정한 코드는 그대로 유지
    expect(codes[1]).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(codes[2]).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  });

  it("does not overwrite an explicitly given student code", () => {
    const rows = [HEADER, ["CUSTOM01", "홍길동", "창동고", "3", "010-1234-5678", "", ""]];
    const { valid } = parseRosterRows(rows);
    expect(valid[0].studentCode).toBe("CUSTOM01");
  });

  it("parses an optional parent phone number (8th column)", () => {
    const rows = [
      HEADER,
      ["S1023", "홍길동", "창동고", "3", "010-1234-5678", "", "", "010-9999-8888"],
    ];
    const { valid, errors } = parseRosterRows(rows);
    expect(errors.length).toBe(0);
    expect(valid[0].parentPhone).toBe("01099998888");
  });

  it("leaves parentPhone undefined when the column is blank", () => {
    const rows = [HEADER, ["S1023", "홍길동", "창동고", "3", "010-1234-5678", "", ""]];
    const { valid } = parseRosterRows(rows);
    expect(valid[0].parentPhone).toBeUndefined();
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

describe("generateSessionsForMonth", () => {
  it("요일별 수업일을 해당 월의 모든 날짜로 생성한다", () => {
    const sessions = generateSessionsForMonth({ mon: 1, wed: 2 }, 2026, 8);
    expect(sessions).toEqual([
      { date: "2026-08-03", status: "normal", makeupDone: false },
      { date: "2026-08-05", status: "normal", makeupDone: false },
      { date: "2026-08-10", status: "normal", makeupDone: false },
      { date: "2026-08-12", status: "normal", makeupDone: false },
      { date: "2026-08-17", status: "normal", makeupDone: false },
      { date: "2026-08-19", status: "normal", makeupDone: false },
      { date: "2026-08-24", status: "normal", makeupDone: false },
      { date: "2026-08-26", status: "normal", makeupDone: false },
      { date: "2026-08-31", status: "normal", makeupDone: false },
    ]);
  });

  it("이미 존재하는 날짜는 중복 생성하지 않는다", () => {
    const sessions = generateSessionsForMonth(
      { mon: 1, wed: 2 },
      2026,
      8,
      ["2026-08-03", "2026-08-05"],
    );
    expect(sessions.map((s) => s.date)).not.toContain("2026-08-03");
    expect(sessions.map((s) => s.date)).not.toContain("2026-08-05");
    expect(sessions.length).toBe(7);
  });

  it("수업요일이 없으면 빈 배열을 반환한다", () => {
    expect(generateSessionsForMonth(undefined, 2026, 8)).toEqual([]);
  });
});

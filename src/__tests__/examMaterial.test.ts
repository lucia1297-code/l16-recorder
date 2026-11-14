import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import * as XLSX from "xlsx";
import { extractExamFields, findDates, findRange } from "../lib/examFieldExtractor";
import { detectKind, docxToText, hwpxToText, hwpSectionToText, xlsxToText, decodeTextBytes } from "../lib/examDocParser";

const NOTICE = `2026학년도 2학기 기말고사 안내
시험 기간: 12.8(월) ~ 12.12(금)
영어 시험일: 12월 10일(수) 2교시
영어: 교과서 3~5과, 부교재 Unit 4-6, 모의고사 프린트
성적 직보일: 12/15(월)`;

describe("날짜 인식", () => {
  it("여러 표기를 인식", () => {
    expect(findDates("2026.11.14 시험", 2026)[0].value).toBe("2026-11-14");
    expect(findDates("11월 3일", 2026)[0].value).toBe("2026-11-03");
    expect(findDates("11/14(금)", 2026)[0].value).toBe("2026-11-14");
  });
  it("요일 없는 슬래시는 loose 모드에서만, 엉뚱한 숫자는 무시", () => {
    expect(findDates("교과서 1.2과", 2026)).toHaveLength(0);
    expect(findDates("13/45", 2026, true)).toHaveLength(0);
  });
  it("기간", () => {
    expect(findRange("5.6(월) ~ 5.9(목)", 2026)).toEqual({ start: "2026-05-06", end: "2026-05-09" });
    expect(findRange("12/8 ~ 12", 2026)).toEqual({ start: "2026-12-08", end: "2026-12-12" });
  });
});

describe("필드 자동 분류", () => {
  it("공문형 텍스트", () => {
    const { fields } = extractExamFields(NOTICE, { today: new Date(2026, 10, 14) });
    expect(fields.semester).toBe("2");
    expect(fields.examType).toBe("final");
    expect(fields.examStart).toBe("2026-12-08");
    expect(fields.examEnd).toBe("2026-12-12");
    expect(fields.englishExamDate).toBe("2026-12-10");
    expect(fields.reportDeadline).toBe("2026-12-15");
    expect(fields.examRange).toContain("교과서 3~5과");
    expect(fields.subject).toBe("영어");
  });
  it("시간표형: 날짜 줄 아래에 과목", () => {
    const t = "1학기 중간고사 시간표\n5/6(화)\n1교시 국어 2교시 영어\n5/7(수)\n1교시 수학";
    const { fields } = extractExamFields(t, { today: new Date(2026, 2, 1) });
    expect(fields.englishExamDate).toBe("2026-05-06");
    expect(fields.examType).toBe("midterm");
  });
  it("학생 이름이 하나만 나오면 매칭", () => {
    const r = extractExamFields("김지유 영어 시험 12월 3일", {
      roster: [{ studentCode: "A", name: "김지유" }, { studentCode: "B", name: "박민수" }],
    });
    expect(r.matchedStudentCodes).toEqual(["A"]);
  });
  it("관련 정보가 없으면 빈 결과", () => {
    expect(extractExamFields("안녕하세요 오늘 점심은 김밥").hits).toHaveLength(0);
  });
});

describe("파일 형식 판별", () => {
  it.each([
    ["a.PNG", "image"], ["a.pdf", "pdf"], ["a.txt", "text"], ["a.csv", "text"],
    ["a.docx", "docx"], ["a.hwp", "hwp"], ["a.hwpx", "hwpx"], ["a.xlsx", "xlsx"], ["a.zip", "unknown"],
  ])("%s → %s", (name, kind) => expect(detectKind({ name })).toBe(kind));
});

describe("파일 → 텍스트", () => {
  it("DOCX", async () => {
    const xml = `<w:document><w:body><w:p><w:r><w:t>영어 시험일</w:t></w:r><w:r><w:t>: 12월 10일</w:t></w:r></w:p><w:p><w:r><w:t>범위 &amp; 교과서</w:t></w:r></w:p></w:body></w:document>`;
    const buf = zipSync({ "word/document.xml": strToU8(xml) });
    const t = await docxToText(buf);
    expect(t).toContain("영어 시험일: 12월 10일");
    expect(t).toContain("범위 & 교과서");
  });
  it("HWPX", async () => {
    const xml = `<hs:sec><hp:p><hp:run><hp:t>영어 시험일: 12월 10일</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>직보일 12/15(월)</hp:t></hp:run></hp:p></hs:sec>`;
    const buf = zipSync({ "Contents/section0.xml": strToU8(xml), "mimetype": strToU8("application/hwp+zip") });
    const t = await hwpxToText(buf);
    expect(t.split("\n")).toContain("영어 시험일: 12월 10일");
  });
  it("HWP 섹션 레코드", () => {
    // PARA_TEXT(tag 67) 레코드 하나: "영어 12월" + 문단끝(13)
    const chars = [..."영어 12월"].map(c => c.charCodeAt(0)).concat([13]);
    const body = new Uint8Array(chars.length * 2);
    chars.forEach((c, i) => new DataView(body.buffer).setUint16(i * 2, c, true));
    const rec = new Uint8Array(4 + body.length);
    new DataView(rec.buffer).setUint32(0, (body.length << 20) | 67, true);
    rec.set(body, 4);
    expect(hwpSectionToText(rec)).toBe("영어 12월");
  });
  it("HWP: 확장 컨트롤(8 WCHAR)은 건너뜀", () => {
    const u16 = (arr: number[]) => { const b = new Uint8Array(arr.length * 2); arr.forEach((c, i) => new DataView(b.buffer).setUint16(i * 2, c, true)); return b; };
    const ctrl = [11, 0, 0, 0, 0, 0, 0, 11]; // 8 WCHAR
    const body = u16([..."가".split("").map(c => c.charCodeAt(0)), ...ctrl, ..."나".split("").map(c => c.charCodeAt(0)), 13]);
    const rec = new Uint8Array(4 + body.length);
    new DataView(rec.buffer).setUint32(0, (body.length << 20) | 67, true);
    rec.set(body, 4);
    expect(hwpSectionToText(rec)).toBe("가나");
  });
  it("XLSX", async () => {
    const ws = XLSX.utils.aoa_to_sheet([["과목", "날짜"], ["영어", "2026-12-10"]]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "시간표");
    const buf = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const t = await xlsxToText(buf);
    expect(t).toContain("영어  2026-12-10");
  });
  it("TXT: EUC-KR 폴백", () => {
    const euckr = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7]); // "이름"
    expect(decodeTextBytes(euckr)).toBe("이름");
    expect(decodeTextBytes(strToU8("영어"))).toBe("영어");
  });
});

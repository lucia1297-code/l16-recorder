import { describe, it, expect } from "vitest";
import {
  computeAll,
  designDifficulty,
  expectedRate,
  gradeOf,
  parseItemsCsv,
  parseResponsesCsv,
  type Item,
  type Response,
} from "../core/itemAnalytics";

const mkItem = (id: string, answer = "1", axes = { A1: 3, A2: 3 } as Item["axes"]): Item => ({
  id, setName: "S1", school: "광남고", questionNo: 1, source: "교과서",
  points: 3, answer, axes, status: "draft",
});

// 학생 n명이 두 문항(Q1,Q2)에 응시. 상위 학생은 둘 다 맞히고 하위 학생은 Q1만 틀림 → Q1 변별도 높음
function make(n: number, rateQ1: number) {
  const items = [mkItem("Q1"), mkItem("Q2")];
  const res: Response[] = [];
  for (let i = 0; i < n; i++) {
    const code = `S${i}`;
    const q1ok = i < Math.round(n * rateQ1); // 앞쪽 학생이 맞힘 = 상위
    res.push({ itemId: "Q1", studentCode: code, chosen: q1ok ? "1" : "2", session: "x" });
    res.push({ itemId: "Q2", studentCode: code, chosen: "1", session: "x" });
  }
  return { items, res };
}

describe("itemAnalytics", () => {
  it("6축 평균과 기대 정답률", () => {
    expect(designDifficulty({ A1: 2, A2: 4 })).toBe(3);
    expect(designDifficulty({})).toBeNull();
    expect(expectedRate(1)).toBeCloseTo(0.95);
    expect(expectedRate(5)).toBeCloseTo(0.15);
  });

  it("표본 30명 미만이면 D등급·LOW_N", () => {
    const { items, res } = make(10, 0.5);
    const s = computeAll(items, res, {});
    expect(s.Q1.grade).toBe("D");
    expect(s.Q1.flags).toContain("LOW_N");
  });

  it("정답률 계산과 변별도(상위가 맞히면 양수)", () => {
    const { items, res } = make(40, 0.5);
    const s = computeAll(items, res, {});
    expect(s.Q1.correctRate).toBeCloseTo(0.5);
    expect(s.Q1.discrimination).toBeGreaterThan(0.5);
  });

  it("너무 어려움·너무 쉬움 플래그", () => {
    const hard = computeAll(...(() => { const m = make(40, 0.1); return [m.items, m.res, {}] as const; })());
    expect(hard.Q1.flags).toContain("TOO_HARD");
    const easy = computeAll(...(() => { const m = make(40, 1); return [m.items, m.res, {}] as const; })());
    expect(easy.Q1.flags).toContain("TOO_EASY");
  });

  it("신고 3건이면 REPORTED", () => {
    const { items, res } = make(40, 0.5);
    const s = computeAll(items, res, { Q1: 3 });
    expect(s.Q1.flags).toContain("REPORTED");
    expect(s.Q1.grade).toBe("C");
  });

  it("등급: 플래그 없음 → 승인 전 B, 승인 후 A", () => {
    expect(gradeOf([], true, false)).toBe("B");
    expect(gradeOf([], true, true)).toBe("A");
    expect(gradeOf(["TOO_EASY"], true, true)).toBe("C");
    expect(gradeOf([], false, true)).toBe("D");
  });

  it("CSV 파싱: 문항·응시", () => {
    const a = parseItemsCsv("id,set,no,answer,A1,A6\nQ1,S1,1,3,2,5");
    expect(a.errors).toEqual([]);
    expect(a.items[0].axes).toEqual({ A1: 2, A6: 5 });
    const b = parseItemsCsv("id,set\nQ1,S1");
    expect(b.errors.length).toBeGreaterThan(0);
    const c = parseResponsesCsv("item_id\tstudent_code\tchosen\nQ1\tS1\t3");
    expect(c.responses[0]).toMatchObject({ itemId: "Q1", chosen: "3", session: "default" });
  });
});

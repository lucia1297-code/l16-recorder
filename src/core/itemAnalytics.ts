// 문항 실측·검수 체계 — 순수 계산 로직 (DB/React 무관)
// 기준값은 기획안 대화에서 제안된 "출발값"이며, 운영하면서 조정한다.

export const THRESHOLDS = {
  minN: 30, // 응시 인원이 이 값 미만이면 통계 미확정
  tooHard: 0.2, // 정답률이 이 값 미만이면 너무 어려움
  tooEasy: 0.95, // 정답률이 이 값 초과이면 너무 쉬움
  minDisc: 0.1, // 변별도가 이 값 미만이면 변별 약함
  reportLimit: 3, // 오류 신고가 이 값 이상이면 플래그
  designGap: 0.25, // 설계 기대 정답률과 실측 정답률 차이 한도
  groupRatio: 0.27, // 변별도 계산용 상·하위 비율
} as const;

export const AXIS_KEYS = ["A1", "A2", "A3", "A4", "A5", "A6"] as const;
export type AxisKey = (typeof AXIS_KEYS)[number];
export type Axes = Partial<Record<AxisKey, number>>; // 각 1~5

export type ItemStatus = "draft" | "approved" | "hold" | "revise";
export type FlagCode =
  | "LOW_N"
  | "TOO_HARD"
  | "TOO_EASY"
  | "LOW_DISC"
  | "DESIGN_GAP"
  | "REPORTED";
export type Grade = "A" | "B" | "C" | "D";

export interface Item {
  id: string;
  setName: string;
  school: string;
  questionNo: number;
  source: string; // 교과서 | 모의고사 | 기타
  points: number;
  answer: string;
  axes: Axes;
  status: ItemStatus;
}

export interface Response {
  itemId: string;
  studentCode: string;
  chosen: string;
  session: string;
}

export interface ItemStats {
  n: number;
  correctRate: number | null;
  discrimination: number | null;
  designDifficulty: number | null; // 6축 평균 (1~5)
  expectedRate: number | null; // 설계 난이도에서 기대한 정답률
  flags: FlagCode[];
  grade: Grade;
}

export const FLAG_LABEL: Record<FlagCode, string> = {
  LOW_N: "표본 부족",
  TOO_HARD: "너무 어려움",
  TOO_EASY: "너무 쉬움",
  LOW_DISC: "변별 약함",
  DESIGN_GAP: "설계-실측 괴리",
  REPORTED: "오류 신고",
};

export function designDifficulty(axes: Axes): number | null {
  const vals = AXIS_KEYS.map((k) => axes[k]).filter(
    (v): v is number => typeof v === "number" && v >= 1 && v <= 5,
  );
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// 설계 난이도 1(쉬움)→기대 정답률 0.95, 5(어려움)→0.15 (선형, 제안값)
export function expectedRate(design: number | null): number | null {
  if (design == null) return null;
  return 0.95 - (design - 1) * 0.2;
}

export function isCorrect(item: Item, r: Response): boolean {
  return r.chosen.trim() === item.answer.trim();
}

/** 세션별 학생 총점(맞힌 문항 수) — 변별도 계산용 */
function studentTotals(items: Item[], responses: Response[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const totals = new Map<string, number>(); // key = session|student
  for (const r of responses) {
    const it = byId.get(r.itemId);
    if (!it) continue;
    const key = `${r.session}|${r.studentCode}`;
    totals.set(key, (totals.get(key) ?? 0) + (isCorrect(it, r) ? 1 : 0));
  }
  return totals;
}

/** 상·하위 27% 정답률 차이. 집단이 너무 작으면 null */
export function discrimination(
  item: Item,
  itemResponses: Response[],
  totals: Map<string, number>,
): number | null {
  const n = itemResponses.length;
  if (n < 4) return null;
  const ranked = itemResponses
    .map((r) => ({ r, total: totals.get(`${r.session}|${r.studentCode}`) ?? 0 }))
    .sort((a, b) => b.total - a.total);
  const k = Math.max(1, Math.round(n * THRESHOLDS.groupRatio));
  const rate = (arr: typeof ranked) =>
    arr.filter((x) => isCorrect(item, x.r)).length / arr.length;
  return rate(ranked.slice(0, k)) - rate(ranked.slice(n - k));
}

export function computeStats(
  item: Item,
  itemResponses: Response[],
  totals: Map<string, number>,
  reportCount: number,
  approvedByOwner: boolean,
): ItemStats {
  const n = itemResponses.length;
  const correctRate =
    n === 0
      ? null
      : itemResponses.filter((r) => isCorrect(item, r)).length / n;
  const disc = discrimination(item, itemResponses, totals);
  const design = designDifficulty(item.axes);
  const expected = expectedRate(design);

  const flags: FlagCode[] = [];
  const enough = n >= THRESHOLDS.minN;
  if (!enough) flags.push("LOW_N");
  if (enough && correctRate != null) {
    if (correctRate < THRESHOLDS.tooHard) flags.push("TOO_HARD");
    if (correctRate > THRESHOLDS.tooEasy) flags.push("TOO_EASY");
    if (disc != null && disc < THRESHOLDS.minDisc) flags.push("LOW_DISC");
    if (expected != null && Math.abs(correctRate - expected) > THRESHOLDS.designGap)
      flags.push("DESIGN_GAP");
  }
  if (reportCount >= THRESHOLDS.reportLimit) flags.push("REPORTED");

  return {
    n,
    correctRate,
    discrimination: disc,
    designDifficulty: design,
    expectedRate: expected,
    flags,
    grade: gradeOf(flags, enough, approvedByOwner),
  };
}

/**
 * 등급(제안): D=표본 부족(미검증), C=실측 플래그 있음,
 * B=플래그 없음·대표 승인 전, A=플래그 없음·대표 승인 완료(판매 가능)
 */
export function gradeOf(
  flags: FlagCode[],
  enough: boolean,
  approvedByOwner: boolean,
): Grade {
  if (!enough) return "D";
  if (flags.length > 0) return "C";
  return approvedByOwner ? "A" : "B";
}

export function computeAll(
  items: Item[],
  responses: Response[],
  reportCounts: Record<string, number>,
): Record<string, ItemStats> {
  const totals = studentTotals(items, responses);
  const grouped = new Map<string, Response[]>();
  for (const r of responses) {
    const arr = grouped.get(r.itemId) ?? [];
    arr.push(r);
    grouped.set(r.itemId, arr);
  }
  const out: Record<string, ItemStats> = {};
  for (const it of items) {
    out[it.id] = computeStats(
      it,
      grouped.get(it.id) ?? [],
      totals,
      reportCounts[it.id] ?? 0,
      it.status === "approved",
    );
  }
  return out;
}

// ── CSV 입력 파싱 (쉼표/탭 구분, 첫 줄은 헤더) ──
function splitRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\t|,/).map((c) => c.trim()));
}

export function parseItemsCsv(text: string): { items: Item[]; errors: string[] } {
  const rows = splitRows(text);
  const errors: string[] = [];
  if (rows.length < 2) return { items: [], errors: ["헤더와 데이터 한 줄 이상이 필요합니다."] };
  const head = rows[0].map((h) => h.toLowerCase());
  const idx = (name: string) => head.indexOf(name.toLowerCase());
  for (const need of ["id", "set", "no", "answer"]) {
    if (idx(need) < 0) errors.push(`헤더에 '${need}' 열이 없습니다.`);
  }
  if (errors.length) return { items: [], errors };
  const items: Item[] = [];
  rows.slice(1).forEach((r, li) => {
    const get = (n: string) => (idx(n) >= 0 ? r[idx(n)] ?? "" : "");
    const id = get("id");
    const no = Number(get("no"));
    if (!id || !Number.isFinite(no)) {
      errors.push(`${li + 2}행: id 또는 no가 올바르지 않습니다.`);
      return;
    }
    const axes: Axes = {};
    for (const k of AXIS_KEYS) {
      const v = Number(get(k));
      if (get(k) !== "" && v >= 1 && v <= 5) axes[k] = v;
    }
    items.push({
      id,
      setName: get("set"),
      school: get("school"),
      questionNo: no,
      source: get("source") || "기타",
      points: Number(get("points")) || 0,
      answer: get("answer"),
      axes,
      status: "draft",
    });
  });
  return { items, errors };
}

export function parseResponsesCsv(
  text: string,
): { responses: Response[]; errors: string[] } {
  const rows = splitRows(text);
  const errors: string[] = [];
  if (rows.length < 2) return { responses: [], errors: ["헤더와 데이터 한 줄 이상이 필요합니다."] };
  const head = rows[0].map((h) => h.toLowerCase());
  const idx = (name: string) => head.indexOf(name);
  for (const need of ["item_id", "student_code", "chosen"]) {
    if (idx(need) < 0) errors.push(`헤더에 '${need}' 열이 없습니다.`);
  }
  if (errors.length) return { responses: [], errors };
  const responses: Response[] = [];
  rows.slice(1).forEach((r, li) => {
    const itemId = r[idx("item_id")];
    const studentCode = r[idx("student_code")];
    if (!itemId || !studentCode) {
      errors.push(`${li + 2}행: item_id 또는 student_code가 비어 있습니다.`);
      return;
    }
    responses.push({
      itemId,
      studentCode,
      chosen: r[idx("chosen")] ?? "",
      session: idx("session") >= 0 ? r[idx("session")] || "default" : "default",
    });
  });
  return { responses, errors };
}

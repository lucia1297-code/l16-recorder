import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listRosterMock = vi.fn();
vi.mock("../lib/rosterStoreFactory", () => ({
  createRosterStore: () => ({ listRoster: listRosterMock }),
}));

import { ensureDailyTodoMemo, checkUpcomingWeek } from "../features/admin/dailyTodoMemo";

const TODAY = new Date("2026-09-15T09:00:00");
const MEMOS_KEY = "l16_memos";

function jsonRes(rows: unknown[]) {
  return { ok: true, json: async () => rows };
}

/** admin_exam_schedules/student_schedules/ww_orders/material_records URL을 구분해서 응답한다 */
function makeFetchMock(rows: {
  schedules?: unknown[];
  scheduleEvents?: unknown[];
  wwOrders?: unknown[];
  materials?: unknown[];
  /** 이 이름을 포함한 URL은 404를 응답한다 (예: 아직 없는 테이블 시뮬레이션) */
  failing?: string[];
}) {
  const notFound = { ok: false, status: 404, json: async () => ({}) };
  return vi.fn(async (url: string) => {
    if (rows.failing?.some((name) => url.includes(name))) return notFound;
    if (url.includes("admin_exam_schedules")) return jsonRes(rows.schedules ?? []);
    if (url.includes("student_schedules")) return jsonRes(rows.scheduleEvents ?? []);
    if (url.includes("ww_orders")) return jsonRes(rows.wwOrders ?? []);
    if (url.includes("material_records")) return jsonRes(rows.materials ?? []);
    throw new Error(`unexpected fetch url: ${url}`);
  });
}

const DEFAULT_ROSTER = [
  { studentCode: "S1", name: "정지민", school: "광영고", grade: "3", phone: "", teacher: "", note: "" },
];

describe("ensureDailyTodoMemo", () => {
  beforeEach(() => {
    localStorage.clear();
    listRosterMock.mockReset();
    listRosterMock.mockResolvedValue(DEFAULT_ROSTER);
    vi.stubGlobal("fetch", makeFetchMock({
      schedules: [
        {
          student_code: "S1", subject: "독해",
          exam_start: "", exam_end: "",
          english_exam_date: "", report_deadline: "",
          next_lesson_date: "2026-09-16",
        },
      ],
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("할일이 있으면 today- 고정 id로 메모를 생성한다", async () => {
    await ensureDailyTodoMemo(TODAY);
    const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
    expect(memos).toHaveLength(1);
    expect(memos[0].id).toBe("todo-2026-09-15");
    expect(memos[0].tag).toBe("할일");
    expect(memos[0].body).toBe("정지민 '독해' 수업자료 준비가 1일 남았습니다.");
  });

  it("같은 날 두 번 호출해도 fetch는 한 번만 한다", async () => {
    await ensureDailyTodoMemo(TODAY);
    await ensureDailyTodoMemo(TODAY);
    expect(fetch).toHaveBeenCalledTimes(4); // schedules + scheduleEvents + wwOrders + materials, 1세트만
  });

  it("할일이 없으면 메모를 만들지 않는다", async () => {
    vi.stubGlobal("fetch", makeFetchMock({}));
    await ensureDailyTodoMemo(TODAY);
    const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
    expect(memos).toHaveLength(0);
  });

  it("결과로 items와 memoId를 돌려준다", async () => {
    const result = await ensureDailyTodoMemo(TODAY);
    expect(result.memoId).toBe("todo-2026-09-15");
    expect(result.items).toHaveLength(1);
  });

  it("force=true면 이미 오늘 실행했어도 다시 계산해서 fetch를 또 호출한다", async () => {
    await ensureDailyTodoMemo(TODAY);
    await ensureDailyTodoMemo(TODAY, true);
    expect(fetch).toHaveBeenCalledTimes(8); // 4개 엔드포인트 x 2번
  });

  it("force=true인데 할일이 없으면 memoId는 null, items는 빈 배열", async () => {
    vi.stubGlobal("fetch", makeFetchMock({}));
    const result = await ensureDailyTodoMemo(TODAY, true);
    expect(result.memoId).toBeNull();
    expect(result.items).toEqual([]);
  });

  it("일정관리/시험지주문/자료배부 데이터도 합쳐서 계산한다", async () => {
    vi.stubGlobal("fetch", makeFetchMock({
      schedules: [],
      scheduleEvents: [
        { student_code: "S1", student_name: "정지민", event_date: "2026-09-16", category: "상담", title: "상담", status: "예정" },
      ],
      wwOrders: [
        { student_code: "S1", student_name: "정지민", exam_date: "2026-09-18", status: "pending" },
      ],
      materials: [
        { student_code: "S1", student_name: "정지민", provided_at: "2026-09-16", material_type: "워크북", status: "배부예정" },
      ],
    }));
    const result = await ensureDailyTodoMemo(TODAY);
    expect(result.items.map((i) => i.type).sort()).toEqual(["material", "scheduleEvent", "wwOrder"].sort());
  });

  it("소스 하나(예: 아직 없는 테이블)가 404여도 나머지 소스는 계속 계산된다", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", makeFetchMock({
      schedules: [
        {
          student_code: "S1", subject: "독해",
          exam_start: "", exam_end: "",
          english_exam_date: "", report_deadline: "",
          next_lesson_date: "2026-09-16",
        },
      ],
      failing: ["ww_orders"],
    }));
    const result = await ensureDailyTodoMemo(TODAY);
    expect(result.items).toEqual([
      { type: "classPrep", studentCode: "S1", message: "정지민 '독해' 수업자료 준비가 1일 남았습니다." },
    ]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("checkUpcomingWeek", () => {
  beforeEach(() => {
    localStorage.clear();
    listRosterMock.mockReset();
    listRosterMock.mockResolvedValue(DEFAULT_ROSTER);
    vi.stubGlobal("fetch", makeFetchMock({
      schedules: [
        {
          student_code: "S1", subject: "독해",
          exam_start: "", exam_end: "",
          english_exam_date: "", report_deadline: "2026-09-20",
          next_lesson_date: "",
        },
      ],
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("일주일 안에 있는 항목을 하나의 메모로 남긴다", async () => {
    const result = await checkUpcomingWeek(TODAY);
    expect(result.items).toHaveLength(1);
    expect(result.memoId).toBe("todo-week-2026-09-15");
    const memos = JSON.parse(localStorage.getItem(MEMOS_KEY) || "[]");
    expect(memos[0].title).toBe("이번 주 할일 (2026-09-15 ~ 2026-09-21)");
    expect(memos[0].body).toBe("[2026-09-17] 정지민 직보 예정일이 3일 남았습니다.");
    expect(memos[0].tag).toBe("할일");
  });

  it("시작일을 옮기면 그 날짜 기준으로 다시 계산한다", async () => {
    // reportDeadline D-3(2026-09-20 기준 admin_exam_schedules mock)은 09-17에 해당돼서
    // 시작일을 09-20으로 옮기면 그 주(09-20~09-26) 창 밖이라 여기선 새 데이터로 다시 확인
    vi.stubGlobal("fetch", makeFetchMock({
      schedules: [
        {
          student_code: "S1", subject: "독해",
          exam_start: "", exam_end: "",
          english_exam_date: "", report_deadline: "2026-09-24",
          next_lesson_date: "",
        },
      ],
    }));
    const result = await checkUpcomingWeek(new Date("2026-09-20T09:00:00"));
    expect(result.memoId).toBe("todo-week-2026-09-20");
  });

  it("일주일 안에 해당되는 게 없으면 메모를 만들지 않는다", async () => {
    vi.stubGlobal("fetch", makeFetchMock({}));
    const result = await checkUpcomingWeek(TODAY);
    expect(result.memoId).toBeNull();
    expect(result.items).toEqual([]);
  });

  it("하루 1회 제한 없이 여러 번 다시 계산할 수 있다", async () => {
    await checkUpcomingWeek(TODAY);
    await checkUpcomingWeek(TODAY);
    expect(fetch).toHaveBeenCalledTimes(8); // 4개 엔드포인트 x 2번
  });
});

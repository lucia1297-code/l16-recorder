import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listRosterMock = vi.fn();
vi.mock("../lib/rosterStoreFactory", () => ({
  createRosterStore: () => ({ listRoster: listRosterMock }),
}));

import { ensureDailyTodoMemo, checkUpcomingWeek } from "../features/admin/dailyTodoMemo";

const TODAY = new Date("2026-09-15T09:00:00");
const MEMOS_KEY = "l16_memos";

describe("ensureDailyTodoMemo", () => {
  beforeEach(() => {
    localStorage.clear();
    listRosterMock.mockReset();
    listRosterMock.mockResolvedValue([
      { studentCode: "S1", name: "정지민", school: "광영고", grade: "3", phone: "", teacher: "", note: "" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
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
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("할일이 없으면 메모를 만들지 않는다", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });
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
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("force=true인데 할일이 없으면 memoId는 null, items는 빈 배열", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    const result = await ensureDailyTodoMemo(TODAY, true);
    expect(result.memoId).toBeNull();
    expect(result.items).toEqual([]);
  });
});

describe("checkUpcomingWeek", () => {
  beforeEach(() => {
    localStorage.clear();
    listRosterMock.mockReset();
    listRosterMock.mockResolvedValue([
      { studentCode: "S1", name: "정지민", school: "광영고", grade: "3", phone: "", teacher: "", note: "" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
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
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          student_code: "S1", subject: "독해",
          exam_start: "", exam_end: "",
          english_exam_date: "", report_deadline: "2026-09-24",
          next_lesson_date: "",
        },
      ],
    });
    const result = await checkUpcomingWeek(new Date("2026-09-20T09:00:00"));
    expect(result.memoId).toBe("todo-week-2026-09-20");
  });

  it("일주일 안에 해당되는 게 없으면 메모를 만들지 않는다", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });
    const result = await checkUpcomingWeek(TODAY);
    expect(result.memoId).toBeNull();
    expect(result.items).toEqual([]);
  });

  it("하루 1회 제한 없이 여러 번 다시 계산할 수 있다", async () => {
    await checkUpcomingWeek(TODAY);
    await checkUpcomingWeek(TODAY);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

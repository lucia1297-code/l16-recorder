import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const listRosterMock = vi.fn();
vi.mock("../lib/rosterStoreFactory", () => ({
  createRosterStore: () => ({ listRoster: listRosterMock }),
}));

import { ensureDailyTodoMemo } from "../features/admin/dailyTodoMemo";

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

import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  createClientMock,
  fromMock,
  upsertMock,
  orderMock,
  selectMock,
} = vi.hoisted(() => {
  const upsertMock = vi.fn();
  const orderMock = vi.fn();
  const selectMock = vi.fn(() => ({ order: orderMock }));
  const fromMock = vi.fn(() => ({ upsert: upsertMock, select: selectMock }));
  return {
    createClientMock: vi.fn(() => ({ from: fromMock })),
    fromMock,
    upsertMock,
    orderMock,
    selectMock,
  };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: createClientMock,
}));

import { SupabaseRosterStore } from "../lib/rosterStore.supabase";
import type { RosterEntry } from "../core/roster";

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    studentCode: "S1023",
    name: "홍길동",
    school: "창동고",
    grade: "3",
    phone: "01012345678",
    teacher: "김민수",
    note: "",
    ...over,
  };
}

function seed(data: Array<Record<string, unknown>>) {
  orderMock.mockResolvedValue({ data, error: null });
}

beforeEach(() => {
  upsertMock.mockReset();
  upsertMock.mockResolvedValue({ error: null });
  orderMock.mockReset();
  orderMock.mockResolvedValue({ data: [], error: null });
});

describe("SupabaseRosterStore — lesson_days 로드", () => {
  it("레거시 배열 ['thu'] 를 { thu: 1 } 로 변환한다", async () => {
    seed([
      {
        student_code: "S1023",
        name: "홍길동",
        school: "창동고",
        grade: "3",
        phone: "01012345678",
        lesson_days: '["thu"]',
      },
    ]);
    const store = new SupabaseRosterStore();
    const all = await store.listRoster();
    expect(all[0].lessonDays).toEqual({ thu: 1 });
  });

  it("레거시 배열 ['wed','fri'] 를 { wed: 1, fri: 1 } 로 변환한다", async () => {
    seed([
      {
        student_code: "S1023",
        name: "홍길동",
        school: "창동고",
        grade: "3",
        phone: "01012345678",
        lesson_days: '["wed","fri"]',
      },
    ]);
    const store = new SupabaseRosterStore();
    const all = await store.listRoster();
    expect(all[0].lessonDays).toEqual({ wed: 1, fri: 1 });
  });

  it("객체 lesson_days 는 그대로 로드한다", async () => {
    seed([
      {
        student_code: "S1023",
        name: "홍길동",
        school: "창동고",
        grade: "3",
        phone: "01012345678",
        lesson_days: '{"mon":1,"wed":2}',
      },
    ]);
    const store = new SupabaseRosterStore();
    const all = await store.listRoster();
    expect(all[0].lessonDays).toEqual({ mon: 1, wed: 2 });
  });

  it("lesson_days 가 없으면 undefined 를 반환한다", async () => {
    seed([
      {
        student_code: "S1023",
        name: "홍길동",
        school: "창동고",
        grade: "3",
        phone: "01012345678",
      },
    ]);
    const store = new SupabaseRosterStore();
    const all = await store.listRoster();
    expect(all[0].lessonDays).toBeUndefined();
  });

  it("저장 시 lesson_days 를 JSON 문자열로 직렬화한다", async () => {
    const store = new SupabaseRosterStore();
    await store.saveRoster([entry({ lessonDays: { mon: 1, wed: 2 } })]);
    const row = upsertMock.mock.calls[0][0][0];
    expect(row.lesson_days).toBe(JSON.stringify({ mon: 1, wed: 2 }));
  });
});

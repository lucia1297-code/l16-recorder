import { describe, it, expect, beforeEach } from "vitest";
import { LocalTeacherLogStore } from "../lib/teacherLogStore.local";
import { createEmptyRows, makeLogId } from "../core/teacherLog";
import type { TeacherLog } from "../core/teacherLog";

function log(over: Partial<TeacherLog> = {}): TeacherLog {
  return {
    id: makeLogId("S1001", "2026-07-24"),
    studentCode: "S1001",
    date: "2026-07-24",
    rows: createEmptyRows(),
    examRecords: [],
    notes: "",
    nextPlan: "",
    classContent: "",
    ...over,
  };
}

describe("LocalTeacherLogStore", () => {
  beforeEach(() => localStorage.clear());

  it("saves and retrieves a log by student+date", async () => {
    const store = new LocalTeacherLogStore();
    await store.saveLog(log());
    const found = await store.getLog("S1001", "2026-07-24");
    expect(found?.id).toBe(makeLogId("S1001", "2026-07-24"));
  });

  it("returns null when no log exists for that student+date", async () => {
    const store = new LocalTeacherLogStore();
    expect(await store.getLog("S9999", "2026-07-24")).toBeNull();
  });

  it("re-saving the same id updates instead of duplicating", async () => {
    const store = new LocalTeacherLogStore();
    await store.saveLog(log({ notes: "첫 저장" }));
    await store.saveLog(log({ notes: "수정됨" }));
    const all = await store.listLogsForStudent("S1001");
    expect(all).toHaveLength(1);
    expect(all[0].notes).toBe("수정됨");
  });

  it("lists all logs for a student sorted by most recent date first", async () => {
    const store = new LocalTeacherLogStore();
    await store.saveLog(log({ id: makeLogId("S1001", "2026-07-20"), date: "2026-07-20" }));
    await store.saveLog(log({ id: makeLogId("S1001", "2026-07-24"), date: "2026-07-24" }));
    const all = await store.listLogsForStudent("S1001");
    expect(all.map((l) => l.date)).toEqual(["2026-07-24", "2026-07-20"]);
  });

  it("only lists logs for the requested student", async () => {
    const store = new LocalTeacherLogStore();
    await store.saveLog(log({ studentCode: "S1001" }));
    await store.saveLog(log({ id: makeLogId("S1002", "2026-07-24"), studentCode: "S1002" }));
    expect(await store.listLogsForStudent("S1001")).toHaveLength(1);
  });
});

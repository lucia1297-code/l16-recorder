import { describe, it, expect, beforeEach } from "vitest";
import { LocalAssignmentStore } from "../lib/assignmentStore.local";
import type { AssignmentType, AssignmentSubmission } from "../core/assignment";

function type(over: Partial<AssignmentType> = {}): AssignmentType {
  return { id: "t1", name: "모의고사 풀이", targetCount: 5, ...over };
}
function submission(over: Partial<AssignmentSubmission> = {}): AssignmentSubmission {
  return {
    id: "s1",
    studentCode: "S1001",
    typeId: "t1",
    round: 1,
    score: 88,
    wrongNumbers: [3, 12],
    submittedAt: "2026-07-13T10:00:00.000Z",
    ...over,
  };
}

describe("LocalAssignmentStore — types", () => {
  beforeEach(() => localStorage.clear());

  it("saves and lists types", async () => {
    const store = new LocalAssignmentStore();
    await store.saveType(type());
    await store.saveType(type({ id: "t2", name: "어휘테스트", targetCount: 3 }));
    const all = await store.listTypes();
    expect(all.length).toBe(2);
  });

  it("updates an existing type by id", async () => {
    const store = new LocalAssignmentStore();
    await store.saveType(type({ targetCount: 5 }));
    await store.saveType(type({ targetCount: 8 }));
    const all = await store.listTypes();
    expect(all.length).toBe(1);
    expect(all[0].targetCount).toBe(8);
  });

  it("deletes a type", async () => {
    const store = new LocalAssignmentStore();
    await store.saveType(type());
    await store.deleteType("t1");
    expect(await store.listTypes()).toEqual([]);
  });
});

describe("LocalAssignmentStore — submissions", () => {
  beforeEach(() => localStorage.clear());

  it("submits and lists all submissions", async () => {
    const store = new LocalAssignmentStore();
    await store.submit(submission());
    await store.submit(submission({ id: "s2", round: 2 }));
    expect((await store.listSubmissions()).length).toBe(2);
  });

  it("filters submissions by student", async () => {
    const store = new LocalAssignmentStore();
    await store.submit(submission({ id: "a", studentCode: "S1001" }));
    await store.submit(submission({ id: "b", studentCode: "S1002" }));
    const forS1001 = await store.listSubmissionsForStudent("S1001");
    expect(forS1001.length).toBe(1);
    expect(forS1001[0].id).toBe("a");
  });

  it("updates an existing submission by id, keeping other fields", async () => {
    const store = new LocalAssignmentStore();
    await store.submit(submission({ id: "a", score: 80 }));
    await store.updateSubmission("a", { score: 95, item: "수정됨" });
    const all = await store.listSubmissions();
    expect(all[0].score).toBe(95);
    expect(all[0].item).toBe("수정됨");
    expect(all[0].studentCode).toBe("S1001"); // 원래 값 유지
  });

  it("does nothing when updating an id that doesn't exist", async () => {
    const store = new LocalAssignmentStore();
    await store.submit(submission({ id: "a" }));
    await store.updateSubmission("nonexistent", { score: 100 });
    const all = await store.listSubmissions();
    expect(all[0].score).not.toBe(100);
  });
});

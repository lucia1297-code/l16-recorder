import { describe, it, expect, beforeEach } from "vitest";
import { LocalExamCheckStore } from "../lib/examCheckStore.local";

describe("LocalExamCheckStore", () => {
  beforeEach(() => localStorage.clear());

  it("submits and lists exam check records", async () => {
    const store = new LocalExamCheckStore();
    await store.submit({
      id: "1",
      studentCode: "S1001",
      studentName: "홍길동",
      answer: "yes",
      answeredAt: "2026-07-24T00:00:00.000Z",
    });
    const all = await store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].answer).toBe("yes");
  });

  it("keeps a history of multiple check-ins for the same student", async () => {
    const store = new LocalExamCheckStore();
    await store.submit({
      id: "1",
      studentCode: "S1001",
      studentName: "홍길동",
      answer: "no",
      answeredAt: "2026-07-24T00:00:00.000Z",
    });
    await store.submit({
      id: "2",
      studentCode: "S1001",
      studentName: "홍길동",
      answer: "yes",
      answeredAt: "2026-07-25T00:00:00.000Z",
    });
    expect(await store.listAll()).toHaveLength(2);
  });
});

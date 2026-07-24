import { describe, it, expect, beforeEach } from "vitest";
import { LocalWarningStore } from "../lib/warningStore.local";

describe("LocalWarningStore", () => {
  beforeEach(() => localStorage.clear());

  it("returns an empty list when nothing saved", async () => {
    const store = new LocalWarningStore();
    expect(await store.listAll()).toEqual([]);
  });

  it("saves and retrieves records", async () => {
    const store = new LocalWarningStore();
    await store.saveAll([
      { studentCode: "S1001", typeId: "t1", count: 2, lastWarnedAt: "2026-07-24T00:00:00.000Z" },
    ]);
    const all = await store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].count).toBe(2);
  });
});

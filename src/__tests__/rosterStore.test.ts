import { describe, it, expect, beforeEach } from "vitest";
import { LocalRosterStore } from "../lib/rosterStore.local";
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

describe("LocalRosterStore", () => {
  beforeEach(() => localStorage.clear());

  it("saves and lists roster entries", async () => {
    const store = new LocalRosterStore();
    await store.saveRoster([entry(), entry({ studentCode: "S1024", phone: "01099998888" })]);
    const all = await store.listRoster();
    expect(all.length).toBe(2);
  });

  it("finds an entry by phone", async () => {
    const store = new LocalRosterStore();
    await store.saveRoster([entry()]);
    const found = await store.findByPhone("01012345678");
    expect(found?.studentCode).toBe("S1023");
  });

  it("returns null when phone not registered", async () => {
    const store = new LocalRosterStore();
    await store.saveRoster([entry()]);
    expect(await store.findByPhone("01000000000")).toBeNull();
  });

  it("overwrites entries with the same student code on re-save", async () => {
    const store = new LocalRosterStore();
    await store.saveRoster([entry({ name: "old name" })]);
    await store.saveRoster([entry({ name: "new name" })]);
    const all = await store.listRoster();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("new name");
  });

  it("when a student's phone number changes, the old number stops matching and the new one works immediately", async () => {
    const store = new LocalRosterStore();
    await store.saveRoster([entry({ phone: "01011112222" })]);
    expect((await store.findByPhone("01011112222"))?.studentCode).toBe("S1023");

    await store.saveRoster([entry({ phone: "01099998888" })]);
    expect(await store.findByPhone("01011112222")).toBeNull();
    expect((await store.findByPhone("01099998888"))?.studentCode).toBe("S1023");
  });

  it("clears the roster", async () => {
    const store = new LocalRosterStore();
    await store.saveRoster([entry()]);
    await store.clearRoster();
    expect(await store.listRoster()).toEqual([]);
  });
});

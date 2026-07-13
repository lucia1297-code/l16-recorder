import { describe, it, expect, beforeEach } from "vitest";
import { LocalPendingStore } from "../lib/pendingStore.local";
import type { PendingRegistration } from "../core/pendingRegistration";

function reg(over: Partial<PendingRegistration> = {}): PendingRegistration {
  return {
    phone: "01012345678",
    name: "홍길동",
    school: "창동고",
    grade: "3",
    requestedAt: "2026-07-13T10:00:00.000Z",
    ...over,
  };
}

describe("LocalPendingStore", () => {
  beforeEach(() => localStorage.clear());

  it("submits and lists pending registrations", async () => {
    const store = new LocalPendingStore();
    await store.submit(reg());
    await store.submit(reg({ phone: "01099998888", name: "김서연" }));
    const all = await store.listPending();
    expect(all.length).toBe(2);
  });

  it("re-submitting the same phone replaces the earlier request", async () => {
    const store = new LocalPendingStore();
    await store.submit(reg({ name: "old" }));
    await store.submit(reg({ name: "new" }));
    const all = await store.listPending();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe("new");
  });

  it("finds a pending registration by phone", async () => {
    const store = new LocalPendingStore();
    await store.submit(reg());
    expect((await store.findByPhone("01012345678"))?.name).toBe("홍길동");
    expect(await store.findByPhone("01000000000")).toBeNull();
  });

  it("approve() removes from pending and returns a completed RosterEntry", async () => {
    const store = new LocalPendingStore();
    await store.submit(reg());
    const entry = await store.approve("01012345678", "S1001");
    expect(entry).toMatchObject({
      studentCode: "S1001",
      name: "홍길동",
      school: "창동고",
      grade: "3",
      phone: "01012345678",
    });
    expect(await store.findByPhone("01012345678")).toBeNull();
  });

  it("approve() returns null for a phone with no pending request", async () => {
    const store = new LocalPendingStore();
    expect(await store.approve("01000000000", "S1001")).toBeNull();
  });

  it("reject() removes the pending request without creating a roster entry", async () => {
    const store = new LocalPendingStore();
    await store.submit(reg());
    await store.reject("01012345678");
    expect(await store.findByPhone("01012345678")).toBeNull();
  });
});

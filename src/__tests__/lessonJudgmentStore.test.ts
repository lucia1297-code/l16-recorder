import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createQuickEvent } from "../core/lessonJudgment";
import { LocalLessonJudgmentStore } from "../lib/lessonJudgmentStore.local";
import { SupabaseLessonJudgmentStore } from "../lib/lessonJudgmentStore.supabase";

function event(eventId: string, studentCode: string | null = null) {
  return createQuickEvent({ eventType: "item_outcome", lessonDate: "2026-11-18", studentCode }, "2026-11-18T01:00:00.000Z", eventId);
}

function revision(revisionId: string, eventId: string, revisionNo: number) {
  return {
    revisionId,
    eventId,
    revisionNo,
    createdAt: `2026-11-18T01:0${revisionNo}:00.000Z`,
    createdBy: "teacher-1",
    detail: {
      initialHypothesis: "",
      observedFact: `관찰 ${revisionNo}`,
      studentStatement: "",
      teacherInterpretation: "",
      revisionReason: "",
      strategyApplied: "",
      observedOutcome: "",
      nextHypothesis: "",
    },
  };
}

function makeMemoryClient(options: { fail?: () => boolean; ownerId?: string } = {}) {
  const rows: Record<string, any[]> = {
    lesson_judgment_events: [],
    lesson_judgment_revisions: [],
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: options.ownerId ?? "teacher-1" } } }, error: null }) },
    from(table: string) {
      let field = "";
      let value: unknown;
      const list = rows[table] ?? (rows[table] = []);
      return {
        insert(payload: any) {
          if (options.fail?.()) return Promise.resolve({ error: new Error("network unavailable") });
          const key = table === "lesson_judgment_events" ? "event_id" : "revision_id";
          if (list.some((row) => row[key] === payload[key]) || (table === "lesson_judgment_revisions" && list.some((row) => row.event_id === payload.event_id && row.revision_no === payload.revision_no))) return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
          list.push(payload);
          return Promise.resolve({ error: null });
        },
        select() { return this; },
        eq(column: string, expected: unknown) { field = column; value = expected; return this; },
        maybeSingle() {
          const data = list.find((row) => row[field] === value) ?? null;
          return Promise.resolve({ data, error: null });
        },
        order() { return this; },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve({ data: list.filter((row) => !field || row[field] === value), error: null }).then(resolve, reject);
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, rows };
}

describe("lesson judgment stores", () => {
  beforeEach(() => localStorage.clear());

  it("saves and filters local events without duplicate retries", async () => {
    const store = new LocalLessonJudgmentStore(localStorage);
    const record = event("event-1", "STU-100");

    expect(await store.appendEvent(record)).toBe("saved");
    expect(await store.appendEvent(record)).toBe("saved");
    expect(await store.listEvents({ studentCode: "STU-100", lessonDate: "2026-11-18" })).toHaveLength(1);
  });

  it("refuses to mutate an existing event with the same UUID", async () => {
    const store = new LocalLessonJudgmentStore(localStorage);
    await store.appendEvent(event("same-id"));

    await expect(store.appendEvent({ ...event("same-id"), outcome: "incorrect" })).rejects.toThrow(/event id/i);
  });

  it("keeps detail revisions append-only and ordered", async () => {
    const store = new LocalLessonJudgmentStore(localStorage);
    await store.appendEvent(event("event-1"));
    await store.appendRevision(revision("rev-1", "event-1", 1));
    await store.appendRevision(revision("rev-2", "event-1", 2));

    expect((await store.listRevisions("event-1")).map((row) => row.revisionNo)).toEqual([1, 2]);
  });

  it("does not serialize student names or phone numbers into the local event store", async () => {
    const store = new LocalLessonJudgmentStore(localStorage);
    await store.appendEvent(event("event-private", "STU-100"));

    const raw = localStorage.getItem("l16.lessonJudgment.events.v1") ?? "";
    expect(raw).toContain("STU-100");
    expect(raw).not.toContain("김민수");
    expect(raw).not.toMatch(/010[- ]?\d{4}[- ]?\d{4}/);
  });

  it("preserves malformed local data instead of overwriting it", async () => {
    const raw = "{broken";
    localStorage.setItem("l16.lessonJudgment.events.v1", raw);
    const store = new LocalLessonJudgmentStore(localStorage);

    await expect(store.appendEvent(event("must-not-overwrite"))).rejects.toThrow(/원본을 보존/);
    expect(localStorage.getItem("l16.lessonJudgment.events.v1")).toBe(raw);
  });

  it("preserves a malformed server outbox instead of replacing it", async () => {
    const raw = "{broken";
    localStorage.setItem("l16.lessonJudgment.outbox.v1", raw);
    const { client } = makeMemoryClient();
    const store = new SupabaseLessonJudgmentStore(client, localStorage);

    await expect(store.appendEvent(event("must-not-overwrite-outbox"))).rejects.toThrow(/원본을 보존/);
    expect(localStorage.getItem("l16.lessonJudgment.outbox.v1")).toBe(raw);
  });

  it("sends one event once and removes it from the outbox after remote success", async () => {
    const { client, rows } = makeMemoryClient();
    const store = new SupabaseLessonJudgmentStore(client, localStorage);

    expect(await store.appendEvent(event("remote-1"))).toBe("saved");
    expect(await store.appendEvent(event("remote-1"))).toBe("saved");
    expect(rows.lesson_judgment_events).toHaveLength(1);
    expect(await store.getOutboxStatus()).toEqual({ count: 0, oldestQueuedAt: null });
  });

  it("treats a matching revision retry as idempotent while rejecting a conflicting event payload", async () => {
    const { client, rows } = makeMemoryClient();
    const store = new SupabaseLessonJudgmentStore(client, localStorage);
    await store.appendEvent(event("conflict-check"));
    await store.appendRevision(revision("same-revision", "conflict-check", 1));
    await store.appendRevision(revision("same-revision", "conflict-check", 1));
    expect(rows.lesson_judgment_revisions).toHaveLength(1);

    await store.appendEvent({ ...event("conflict-check"), outcome: "incorrect" });
    expect(await store.getOutboxStatus()).toEqual({ count: 1, oldestQueuedAt: expect.any(String) });
    expect(rows.lesson_judgment_events).toHaveLength(1);
  });

  it("moves an unsent revision to the next number when another device claimed its number", async () => {
    const { client, rows } = makeMemoryClient();
    const store = new SupabaseLessonJudgmentStore(client, localStorage);
    await store.appendEvent(event("revision-race"));
    rows.lesson_judgment_revisions.push({
      revision_id: "other-device-revision", event_id: "revision-race", revision_no: 1,
      created_at: "2026-11-18T01:01:00.000Z", detail: revision("other-device-revision", "revision-race", 1).detail,
    });

    await store.appendRevision(revision("local-device-revision", "revision-race", 1));

    expect(rows.lesson_judgment_revisions.map((row) => row.revision_no).sort()).toEqual([1, 2]);
    expect(await store.getOutboxStatus()).toEqual({ count: 0, oldestQueuedAt: null });
  });

  it("retains failed events and retries the same UUID successfully", async () => {
    let shouldFail = true;
    const { client, rows } = makeMemoryClient({ fail: () => shouldFail });
    const store = new SupabaseLessonJudgmentStore(client, localStorage, () => "2026-11-18T01:00:00.000Z");

    expect(await store.appendEvent(event("retry-1"))).toBe("queued");
    expect(await store.getOutboxStatus()).toEqual({ count: 1, oldestQueuedAt: "2026-11-18T01:00:00.000Z" });
    shouldFail = false;

    expect(await store.flushOutbox()).toEqual({ synced: 1, remaining: 0 });
    expect(rows.lesson_judgment_events.map((row) => row.event_id)).toEqual(["retry-1"]);
  });

  it("isolates pending records by authenticated owner in a shared browser", async () => {
    const failedOwner = makeMemoryClient({ ownerId: "teacher-A", fail: () => true });
    const otherOwner = makeMemoryClient({ ownerId: "teacher-B" });
    const storeA = new SupabaseLessonJudgmentStore(failedOwner.client, localStorage);
    const storeB = new SupabaseLessonJudgmentStore(otherOwner.client, localStorage);

    expect(await storeA.appendEvent(event("private-to-A", "S-PRIVATE"))).toBe("queued");
    expect(await storeB.getOutboxStatus()).toEqual({ count: 0, oldestQueuedAt: null });
    expect(await storeB.listQueuedEventIds()).toEqual([]);
    expect(await storeB.flushOutbox()).toEqual({ synced: 0, remaining: 0 });
    expect(otherOwner.rows.lesson_judgment_events).toHaveLength(0);
    expect(await storeA.getOutboxStatus()).toMatchObject({ count: 1 });
  });

  it("keeps failed queue entries and supports explicit deletion", async () => {
    const { client } = makeMemoryClient({ fail: () => true });
    const store = new SupabaseLessonJudgmentStore(client, localStorage, () => "2026-11-18T02:00:00.000Z");
    await store.appendEvent(event("delete-me"));
    await store.appendRevision(revision("rev-pending", "delete-me", 1));

    expect(await store.flushOutbox()).toEqual({ synced: 0, remaining: 2 });
    expect(await store.getOutboxStatus()).toEqual({ count: 2, oldestQueuedAt: "2026-11-18T02:00:00.000Z" });
    await store.deleteQueuedEvent("delete-me");
    expect(await store.getOutboxStatus()).toEqual({ count: 0, oldestQueuedAt: null });
  });
});

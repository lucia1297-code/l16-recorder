import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { LessonJudgmentEvent, LessonJudgmentRevision } from "../core/lessonJudgment";
import type { LessonJudgmentFilter, LessonJudgmentStore } from "./lessonJudgmentStore";

const OUTBOX_KEY = "l16.lessonJudgment.outbox.v1";
type OutboxEntry =
  | { kind: "event"; id: string; eventId: string; ownerId: string; queuedAt: string; payload: LessonJudgmentEvent }
  | { kind: "revision"; id: string; eventId: string; ownerId: string; queuedAt: string; payload: LessonJudgmentRevision };

function makeClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) throw new Error("Supabase environment variables are missing.");
  return createClient(url, key);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function revisionForComparison(revision: LessonJudgmentRevision): Omit<LessonJudgmentRevision, "createdBy"> {
  const { createdBy: _createdBy, ...stable } = revision;
  return stable;
}

function eventRow(event: LessonJudgmentEvent) {
  return {
    event_id: event.eventId,
    schema_version: event.schemaVersion,
    event_type: event.eventType,
    recorded_at: event.recordedAt,
    lesson_date: event.lessonDate,
    student_code: event.studentCode,
    session_ref: event.sessionRef,
    item_id: event.itemId,
    item_version: event.itemVersion,
    judgment_code: event.judgmentCode ?? null,
    outcome: event.outcome ?? null,
    reason_tags: event.reasonTags,
    record_status: event.recordStatus,
    detail: event.detail,
  };
}

function eventFromRow(row: any): LessonJudgmentEvent {
  return {
    eventId: row.event_id,
    schemaVersion: row.schema_version,
    eventType: row.event_type,
    recordedAt: row.recorded_at,
    lessonDate: row.lesson_date,
    studentCode: row.student_code ?? null,
    sessionRef: row.session_ref ?? null,
    itemId: row.item_id ?? null,
    itemVersion: row.item_version ?? null,
    ...(row.judgment_code ? { judgmentCode: row.judgment_code } : {}),
    ...(row.outcome ? { outcome: row.outcome } : {}),
    reasonTags: row.reason_tags ?? [],
    recordStatus: row.record_status,
    detail: row.detail,
  };
}

function revisionRow(revision: LessonJudgmentRevision) {
  return {
    revision_id: revision.revisionId,
    event_id: revision.eventId,
    revision_no: revision.revisionNo,
    created_at: revision.createdAt,
    detail: revision.detail,
  };
}

function revisionFromRow(row: any): LessonJudgmentRevision {
  return {
    revisionId: row.revision_id,
    eventId: row.event_id,
    revisionNo: row.revision_no,
    createdAt: row.created_at,
    createdBy: row.created_by ?? "",
    detail: row.detail,
  };
}

export class SupabaseLessonJudgmentStore implements LessonJudgmentStore {
  constructor(
    private readonly client: SupabaseClient = makeClient(),
    private readonly storage: Storage = localStorage,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async appendEvent(event: LessonJudgmentEvent): Promise<"saved" | "queued"> {
    const ownerId = await this.requireOwnerId();
    this.enqueue({ kind: "event", id: event.eventId, eventId: event.eventId, ownerId, queuedAt: this.now(), payload: event });
    await this.flushOutbox();
    return this.readOutbox().some((entry) => entry.ownerId === ownerId && entry.kind === "event" && entry.id === event.eventId) ? "queued" : "saved";
  }

  async listEvents(filter: LessonJudgmentFilter = {}): Promise<LessonJudgmentEvent[]> {
    let remote: LessonJudgmentEvent[] = [];
    try {
      let query = this.client.from("lesson_judgment_events").select("*");
      if (filter.studentCode) query = query.eq("student_code", filter.studentCode);
      if (filter.lessonDate) query = query.eq("lesson_date", filter.lessonDate);
      if (filter.itemId) query = query.eq("item_id", filter.itemId);
      const { data, error } = await query.order("recorded_at", { ascending: false });
      if (error) throw error;
      remote = (data ?? []).map(eventFromRow);
    } catch {
      // Keep the local outbox readable while offline or before an approved migration is applied.
    }
    const ownerId = await this.requireOwnerId();
    const queued = this.readOutbox().filter((entry): entry is Extract<OutboxEntry, { kind: "event" }> => entry.ownerId === ownerId && entry.kind === "event").map((entry) => entry.payload);
    const merged = new Map<string, LessonJudgmentEvent>();
    [...remote, ...queued].forEach((event) => merged.set(event.eventId, event));
    return [...merged.values()]
      .filter((event) => !filter.studentCode || event.studentCode === filter.studentCode)
      .filter((event) => !filter.lessonDate || event.lessonDate === filter.lessonDate)
      .filter((event) => !filter.itemId || event.itemId === filter.itemId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  async appendRevision(revision: LessonJudgmentRevision): Promise<void> {
    const ownerId = await this.requireOwnerId();
    this.enqueue({ kind: "revision", id: revision.revisionId, eventId: revision.eventId, ownerId, queuedAt: this.now(), payload: revision });
    await this.flushOutbox();
  }

  async listRevisions(eventId: string): Promise<LessonJudgmentRevision[]> {
    let remote: LessonJudgmentRevision[] = [];
    try {
      const { data, error } = await this.client.from("lesson_judgment_revisions").select("*").eq("event_id", eventId).order("revision_no", { ascending: true });
      if (error) throw error;
      remote = (data ?? []).map(revisionFromRow);
    } catch {
      // Pending revisions remain available from the local outbox.
    }
    const ownerId = await this.requireOwnerId();
    const queued = this.readOutbox().filter((entry): entry is Extract<OutboxEntry, { kind: "revision" }> => entry.ownerId === ownerId && entry.kind === "revision" && entry.eventId === eventId).map((entry) => entry.payload);
    const merged = new Map<string, LessonJudgmentRevision>();
    [...remote, ...queued].forEach((revision) => merged.set(revision.revisionId, revision));
    return [...merged.values()].sort((a, b) => a.revisionNo - b.revisionNo);
  }

  async flushOutbox(): Promise<{ synced: number; remaining: number }> {
    const ownerId = await this.requireOwnerId();
    const pending = this.readOutbox().filter((entry) => entry.ownerId === ownerId);
    let synced = 0;
    const completedIds = new Set<string>();
    for (const entry of pending) {
      let currentEntry = entry;
      let completed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const table = currentEntry.kind === "event" ? "lesson_judgment_events" : "lesson_judgment_revisions";
        const row = currentEntry.kind === "event" ? eventRow(currentEntry.payload) : revisionRow(currentEntry.payload);
        const key = currentEntry.kind === "event" ? "event_id" : "revision_id";
        const expected = currentEntry.kind === "event" ? currentEntry.payload : revisionForComparison(currentEntry.payload);
        let error: any;
        try {
          ({ error } = await this.client.from(table as any).insert(row as any));
        } catch {
          break;
        }
        if (!error) { completed = true; break; }
        if (error.code !== "23505") break;

        const { data, error: readError } = await this.client.from(table).select("*").eq(key, currentEntry.id).maybeSingle();
        if (readError) break;
        if (data) {
          const existing = currentEntry.kind === "event" ? eventFromRow(data) : revisionForComparison(revisionFromRow(data));
          completed = canonical(existing) === canonical(expected);
          break;
        }
        if (currentEntry.kind !== "revision") break;

        // A different client may have claimed this revision_no. Keep the same revision UUID/content
        // and move only this still-pending row to the next observed number, with bounded retries.
        const known = await this.listRevisions(currentEntry.eventId);
        const nextNo = Math.max(0, ...known.filter((revision) => revision.revisionId !== currentEntry.id).map((revision) => revision.revisionNo)) + 1;
        if (nextNo === currentEntry.payload.revisionNo) break;
        currentEntry = { ...currentEntry, payload: { ...currentEntry.payload, revisionNo: nextNo } };
        const revisedEntry = currentEntry;
        this.writeOutbox(this.readOutbox().map((queued) => queued.ownerId === ownerId && queued.id === revisedEntry.id ? revisedEntry : queued));
      }
      if (!completed) break;
      completedIds.add(entry.id);
      synced++;
    }
    if (completedIds.size) this.writeOutbox(this.readOutbox().filter((entry) => entry.ownerId !== ownerId || !completedIds.has(entry.id)));
    return { synced, remaining: this.readOutbox().filter((entry) => entry.ownerId === ownerId).length };
  }

  async getOutboxStatus(): Promise<{ count: number; oldestQueuedAt: string | null }> {
    const ownerId = await this.requireOwnerId();
    const pending = this.readOutbox().filter((entry) => entry.ownerId === ownerId);
    return { count: pending.length, oldestQueuedAt: pending.map((entry) => entry.queuedAt).sort()[0] ?? null };
  }

  async listQueuedEventIds(): Promise<string[]> {
    const ownerId = await this.requireOwnerId();
    return [...new Set(this.readOutbox().filter((entry) => entry.ownerId === ownerId).map((entry) => entry.eventId))];
  }

  async deleteQueuedEvent(eventId: string): Promise<void> {
    const ownerId = await this.requireOwnerId();
    this.writeOutbox(this.readOutbox().filter((entry) => entry.ownerId !== ownerId || entry.eventId !== eventId));
  }

  private async requireOwnerId(): Promise<string> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    const ownerId = data.session?.user.id;
    if (!ownerId) throw new Error("로그인한 사용자 확인 후 판단 기록을 저장할 수 있습니다.");
    return ownerId;
  }

  private enqueue(entry: OutboxEntry): void {
    const pending = this.readOutbox();
    const current = pending.find((candidate) => candidate.id === entry.id && candidate.ownerId === entry.ownerId);
    if (current) {
      if (canonical(current.payload) !== canonical(entry.payload)) throw new Error("Event ID already exists with different content.");
      return;
    }
    pending.push(entry);
    this.writeOutbox(pending);
  }

  private readOutbox(): OutboxEntry[] {
    try {
      const value: unknown = JSON.parse(this.storage.getItem(OUTBOX_KEY) ?? "[]");
      if (!Array.isArray(value)) throw new Error("미전송 기록 저장 형식이 올바르지 않습니다. 원본을 지우지 않았습니다.");
      return value as OutboxEntry[];
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("미전송 기록 데이터가 손상된 것 같습니다. 원본을 보존했으며 새 기록을 추가하지 않았습니다.");
      throw error;
    }
  }

  private writeOutbox(entries: OutboxEntry[]): void {
    this.storage.setItem(OUTBOX_KEY, JSON.stringify(entries));
  }
}

import type { LessonJudgmentEvent, LessonJudgmentRevision } from "../core/lessonJudgment";
import type { LessonJudgmentFilter, LessonJudgmentStore } from "./lessonJudgmentStore";

export const LESSON_JUDGMENT_EVENTS_KEY = "l16.lessonJudgment.events.v1";
export const LESSON_JUDGMENT_REVISIONS_KEY = "l16.lessonJudgment.revisions.v1";

function readList<T>(storage: Storage, key: string): T[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("수업 판단 기록 저장 형식이 올바르지 않습니다. 원본을 보존했습니다.");
    return value as T[];
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("수업 판단 기록 데이터가 손상된 것 같습니다. 원본을 보존했고 새 기록으로 덮어쓰지 않았습니다.");
    throw error;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class LocalLessonJudgmentStore implements LessonJudgmentStore {
  constructor(private readonly storage: Storage = localStorage) {}

  async appendEvent(event: LessonJudgmentEvent): Promise<"saved"> {
    const events = readList<LessonJudgmentEvent>(this.storage, LESSON_JUDGMENT_EVENTS_KEY);
    const current = events.find((row) => row.eventId === event.eventId);
    if (current) {
      if (canonical(current) !== canonical(event)) throw new Error("Event ID already exists with different content.");
      return "saved";
    }
    events.push(event);
    this.storage.setItem(LESSON_JUDGMENT_EVENTS_KEY, JSON.stringify(events));
    return "saved";
  }

  async listEvents(filter: LessonJudgmentFilter = {}): Promise<LessonJudgmentEvent[]> {
    return readList<LessonJudgmentEvent>(this.storage, LESSON_JUDGMENT_EVENTS_KEY)
      .filter((event) => !filter.studentCode || event.studentCode === filter.studentCode)
      .filter((event) => !filter.lessonDate || event.lessonDate === filter.lessonDate)
      .filter((event) => !filter.itemId || event.itemId === filter.itemId)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  }

  async appendRevision(revision: LessonJudgmentRevision): Promise<void> {
    const events = readList<LessonJudgmentEvent>(this.storage, LESSON_JUDGMENT_EVENTS_KEY);
    if (!events.some((event) => event.eventId === revision.eventId)) throw new Error("Cannot revise a missing quick event.");
    const revisions = readList<LessonJudgmentRevision>(this.storage, LESSON_JUDGMENT_REVISIONS_KEY);
    const current = revisions.find((row) => row.revisionId === revision.revisionId);
    if (current) {
      if (canonical(current) !== canonical(revision)) throw new Error("Revision ID already exists with different content.");
      return;
    }
    if (revisions.some((row) => row.eventId === revision.eventId && row.revisionNo === revision.revisionNo)) {
      throw new Error("Revision number already exists for this event.");
    }
    revisions.push(revision);
    this.storage.setItem(LESSON_JUDGMENT_REVISIONS_KEY, JSON.stringify(revisions));
  }

  async listRevisions(eventId: string): Promise<LessonJudgmentRevision[]> {
    return readList<LessonJudgmentRevision>(this.storage, LESSON_JUDGMENT_REVISIONS_KEY)
      .filter((revision) => revision.eventId === eventId)
      .sort((a, b) => a.revisionNo - b.revisionNo);
  }

  async flushOutbox() { return { synced: 0, remaining: 0 }; }

  async getOutboxStatus() { return { count: 0, oldestQueuedAt: null }; }

  async listQueuedEventIds() { return []; }

  async deleteQueuedEvent(_eventId: string): Promise<void> {
    throw new Error("Local saved events are not queued for server sync.");
  }
}

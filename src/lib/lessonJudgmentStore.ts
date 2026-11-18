import type { LessonJudgmentEvent, LessonJudgmentRevision } from "../core/lessonJudgment";

export interface LessonJudgmentFilter {
  studentCode?: string;
  lessonDate?: string;
  itemId?: string;
}

export interface LessonJudgmentStore {
  appendEvent(event: LessonJudgmentEvent): Promise<"saved" | "queued">;
  listEvents(filter?: LessonJudgmentFilter): Promise<LessonJudgmentEvent[]>;
  appendRevision(revision: LessonJudgmentRevision): Promise<void>;
  listRevisions(eventId: string): Promise<LessonJudgmentRevision[]>;
  flushOutbox(): Promise<{ synced: number; remaining: number }>;
  getOutboxStatus(): Promise<{ count: number; oldestQueuedAt: string | null }>;
  listQueuedEventIds(): Promise<string[]>;
  deleteQueuedEvent(eventId: string): Promise<void>;
}

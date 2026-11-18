export type QuickOutcome = "correct" | "incorrect" | "hold" | "unverified";

export type JudgmentCode = "J-01" | "J-02" | "J-03" | "J-04";

export type ReasonTag =
  | "vocabulary"
  | "sentence_structure"
  | "logic"
  | "inference"
  | "choice_judgment"
  | "time"
  | "other";

export type LessonJudgmentEventType =
  | "item_outcome"
  | "judgment_changed"
  | "new_discovery"
  | "explanation_effect"
  | "follow_up_review"
  | "lesson_plan_saved"
  | "lesson_review_saved";

export type LessonJudgmentRecordStatus = "quick_saved" | "needs_detail" | "complete";

export interface LessonJudgmentDetail {
  initialHypothesis: string;
  observedFact: string;
  studentStatement: string;
  teacherInterpretation: string;
  revisionReason: string;
  strategyApplied: string;
  observedOutcome: string;
  nextHypothesis: string;
}

export interface CreateQuickEventInput {
  eventType: LessonJudgmentEventType;
  lessonDate: string;
  studentCode?: string | null;
  sessionRef?: string | null;
  itemId?: string | null;
  itemVersion?: string | null;
  outcome?: QuickOutcome;
  reasonTags?: ReasonTag[];
}

export interface LessonJudgmentEvent {
  eventId: string;
  schemaVersion: "1.0";
  eventType: LessonJudgmentEventType;
  recordedAt: string;
  lessonDate: string;
  studentCode: string | null;
  sessionRef: string | null;
  itemId: string | null;
  itemVersion: string | null;
  judgmentCode?: JudgmentCode;
  outcome?: QuickOutcome;
  reasonTags: ReasonTag[];
  recordStatus: LessonJudgmentRecordStatus;
  detail: LessonJudgmentDetail;
}

export interface LessonJudgmentRevision {
  revisionId: string;
  eventId: string;
  revisionNo: number;
  createdAt: string;
  createdBy: string;
  detail: LessonJudgmentDetail;
}

const JUDGMENT_CODE_BY_EVENT: Partial<Record<LessonJudgmentEventType, JudgmentCode>> = {
  judgment_changed: "J-01",
  new_discovery: "J-02",
  explanation_effect: "J-03",
  follow_up_review: "J-04",
};

const EMPTY_DETAIL: LessonJudgmentDetail = {
  initialHypothesis: "",
  observedFact: "",
  studentStatement: "",
  teacherInterpretation: "",
  revisionReason: "",
  strategyApplied: "",
  observedOutcome: "",
  nextHypothesis: "",
};

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function createQuickEvent(
  input: CreateQuickEventInput,
  now = new Date().toISOString(),
  id: string = crypto.randomUUID(),
): LessonJudgmentEvent {
  if (!isValidDate(input.lessonDate)) throw new Error("Invalid lesson date; expected a real ISO calendar date.");
  if (input.eventType !== "item_outcome" && input.outcome !== undefined) {
    throw new Error("Outcome is only valid for an item outcome event.");
  }
  if (input.eventType !== "item_outcome" && input.reasonTags?.length) {
    throw new Error("Reason tags are only valid for an item outcome event.");
  }

  const judgmentCode = JUDGMENT_CODE_BY_EVENT[input.eventType];
  return {
    eventId: id,
    schemaVersion: "1.0",
    eventType: input.eventType,
    recordedAt: now,
    lessonDate: input.lessonDate,
    studentCode: input.studentCode ?? null,
    sessionRef: input.sessionRef ?? null,
    itemId: input.itemId ?? null,
    itemVersion: input.itemVersion ?? null,
    ...(judgmentCode ? { judgmentCode } : {}),
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    reasonTags: [...(input.reasonTags ?? [])],
    recordStatus: "quick_saved",
    detail: { ...EMPTY_DETAIL },
  };
}

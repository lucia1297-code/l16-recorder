export type ExamCheckAnswer = "yes" | "no" | "na";

export const EXAM_CHECK_ANSWER_LABELS: Record<ExamCheckAnswer, string> = {
  yes: "예",
  no: "아니오",
  na: "해당없음",
};

export interface ExamCheckRecord {
  id: string;
  studentCode: string;
  studentName: string;
  answer: ExamCheckAnswer;
  answeredAt: string; // ISO
}

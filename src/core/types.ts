// ===== 오답 원인 =====
export const WRONG_REASONS = [
  "Vocabulary",
  "Grammar",
  "Reading",
  "Inference",
  "Logic",
  "Time",
  "Careless",
  "Guess",
  "DidntKnow",
  "Other",
] as const;
export type WrongReason = (typeof WRONG_REASONS)[number];

export const WRONG_REASON_LABELS: Record<WrongReason, string> = {
  Vocabulary: "어휘",
  Grammar: "어법",
  Reading: "독해",
  Inference: "추론",
  Logic: "논리",
  Time: "시간부족",
  Careless: "실수",
  Guess: "찍음",
  DidntKnow: "모름",
  Other: "기타",
};

// ===== 학생 정보 =====
export interface StudentInfo {
  studentCode: string;
  name: string;
  school: string;
  grade: string;
}

// ===== 시험 정보 =====
export interface ExamInfo {
  examName: string;
  year: number;
  month: number;
  round: number; // 회차
  totalQuestions: number; // 총문항수
  maxScore: number; // 총점(만점)
}

// ===== 문항별 오답 =====
export interface WrongAnswerEntry {
  questionNo: number; // 1~totalQuestions
  reasons: WrongReason[];
}

// ===== 최종 회고 =====
export interface Reflection {
  hardestReason: string; // 가장 어려웠던 이유
  nextGoal: string; // 다음 시험 목표
  satisfaction: number; // 1~5 만족도
}

// ===== 제출 결과(하나의 완성 레코드) =====
export interface ExamResult {
  id: string;
  student: StudentInfo;
  exam: ExamInfo;
  teacher: string;
  date: string; // ISO
  score: number; // 학생 총점
  wrongAnswers: WrongAnswerEntry[];
  reflection: Reflection;
  submittedAt: string; // ISO
}

// 제출 전 작성 중 상태 (자동 저장 대상)
export interface DraftResult {
  phone?: string;
  student: Partial<StudentInfo>;
  exam: Partial<ExamInfo>;
  teacher: string;
  score: number | null;
  wrongAnswers: WrongAnswerEntry[];
  reflection: Partial<Reflection>;
  step: number;
}

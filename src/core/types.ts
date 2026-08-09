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
  isThreePoint?: boolean; // 3점 문항 여부
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
export interface QuestionDetail {
  questionNo: number;
  chosenOption: string;       // 선택한 선지 번호
  confidenceBefore: number;   // 자신감 (0~100)
  reasonStudent: string;      // 선택 이유
  evidenceSentence: string;   // 근거 문장
  missedSignal: string;       // 놓친 신호
  optionElimination: Record<string, string>; // 선지 소거 {1:"반대", 2:"정답후보"...}
  studentNextAction: string;  // 다음 행동 계획
}

export interface DraftResult {
  phone?: string;
  student: Partial<StudentInfo>;
  exam: Partial<ExamInfo>;
  teacher: string;
  score: number | null;
  solvingTime: number | null; // 총 풀이 시간 (분)
  wrongAnswers: WrongAnswerEntry[];
  reflection: Partial<Reflection>;
  step: number;
  questionDetails?: QuestionDetail[]; // 상위 3개 상세 입력
}

export const MAX_ASSIGNMENT_TYPES = 8;

export interface AssignmentType {
  id: string;
  name: string;
  targetCount: number; // 지정 과제 수 (예: 모의고사 풀이 3회분)
  kind?: "mock_exam" | "general"; // 명시적 구분 — 없으면 이름에 "모의고사" 포함 여부로 추정(하위호환)
  // 일반과제일 때 학생 화면에 보일 필드 이름 (선택, 비워두면 기본값 사용)
  itemLabel?: string;
  scopeLabel?: string;
  completedLabel?: string;
}

export interface AssignmentSubmission {
  id: string;
  studentCode: string;
  typeId: string;
  round: number; // 몇 회차인지 — 자유 등록 가능 (지정 회차를 넘어가도 됨)
  score: number | null; // 점수 (선택)
  wrongNumbers: number[]; // 틀린 문항 번호 (자유 입력, 선택)
  submittedAt: string; // ISO

  // 모의고사 세부풀이시간 (선택, "세부내용 첨부"가 켜져 있을 때만 사용)
  totalMinutes?: number;
  step1Minutes?: number;
  step2Minutes?: number;
  step3Minutes?: number;

  // 모의고사 외 일반 과제용 (선택)
  item?: string; // 항목, 예: "어휘 Day5"
  scope?: string; // 범위, 예: "101~150번"
  completed?: boolean; // 완료여부

  // 강사 2차 점검 (선택 — 제출 직후에는 비어있고, 강사가 확인하면 채워짐)
  reviewStatus?: "pending" | "pass" | "fail";
  reviewedAt?: string; // ISO
  reviewNote?: string;
}

export type AssignmentStatus = "good" | "not_bad" | "warning" | "none";

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  good: "good",
  not_bad: "not bad",
  warning: "경고",
  none: "-",
};

/**
 * 제출 개수를 지정 과제 수와 비교해 상태를 판단한다.
 * - 지정만큼 다 했으면 good
 * - 일부만 했으면 not bad
 * - 하나도 안 했으면 경고
 * - 애초에 지정된 과제가 없으면 none
 */
export function computeAssignmentStatus(
  submittedCount: number,
  targetCount: number,
): AssignmentStatus {
  if (targetCount <= 0) return "none";
  if (submittedCount >= targetCount) return "good";
  if (submittedCount > 0) return "not_bad";
  return "warning";
}

export function countSubmissionsForType(
  submissions: AssignmentSubmission[],
  studentCode: string,
  typeId: string,
): number {
  return submissions.filter((s) => s.studentCode === studentCode && s.typeId === typeId).length;
}

/**
 * 학생이 다음에 제출할 회차를 자동으로 계산한다 (기존 제출 개수 + 1).
 * "모의고사 풀이"처럼 회차가 실제 시험 회차와 일치해야 하는 유형은 이 함수를 쓰지 않고
 * 학생이 직접 입력하게 한다 — isAutoRoundType 으로 구분한다.
 */
export function computeNextRound(
  submissions: AssignmentSubmission[],
  studentCode: string,
  typeId: string,
): number {
  return countSubmissionsForType(submissions, studentCode, typeId) + 1;
}

/**
 * 과제 유형 이름에 "모의고사"가 들어가면 회차를 학생이 직접 입력하게 하고(실제 시험 회차와
 * 맞춰야 하므로), 그 외 유형은 회차를 자동 계산해 학생 입력을 생략한다.
 */
export function isAutoRoundType(typeName: string): boolean {
  return !typeName.includes("모의고사");
}

/**
 * 이 과제 유형이 "모의고사 형식"(회차/점수/틀린문항 + 세부풀이시간)인지 판단한다.
 * kind 필드가 있으면 그걸 그대로 쓰고(관리자가 이름과 무관하게 직접 지정),
 * 없으면(과거에 만든 유형) 기존처럼 이름에 "모의고사"가 들어있는지로 추정한다.
 */
export function isMockExamKind(type: AssignmentType): boolean {
  if (type.kind) return type.kind === "mock_exam";
  return !isAutoRoundType(type.name);
}

export interface GeneralFieldLabels {
  itemLabel: string;
  scopeLabel: string;
  completedLabel: string;
}

const DEFAULT_ITEM_LABEL = "분야명";
const DEFAULT_SCOPE_LABEL = "학습내용";
const DEFAULT_COMPLETED_LABEL = "완수여부";

/**
 * 일반과제 유형에서 학생 화면에 보여줄 필드 이름을 결정한다.
 * 관리자가 직접 지정하지 않았거나 빈 문자열이면 기본값(분야명/학습내용/완수여부)을 쓴다.
 */
export function getGeneralFieldLabels(type: AssignmentType): GeneralFieldLabels {
  return {
    itemLabel: type.itemLabel?.trim() || DEFAULT_ITEM_LABEL,
    scopeLabel: type.scopeLabel?.trim() || DEFAULT_SCOPE_LABEL,
    completedLabel: type.completedLabel?.trim() || DEFAULT_COMPLETED_LABEL,
  };
}

export const REVIEW_STATUS_LABELS: Record<"pending" | "pass" | "fail", string> = {
  pending: "점검 대기",
  pass: "확인 완료",
  fail: "재제출 필요",
};

/**
 * 강사가 아직 2차 점검을 안 한 제출 건인지 — reviewStatus 가 없거나 'pending' 이면 대기중.
 */
export function isPendingReview(submission: AssignmentSubmission): boolean {
  return !submission.reviewStatus || submission.reviewStatus === "pending";
}

export interface AssignmentTypeInput {
  name: string;
  targetCount: number;
}

/**
 * 관리자가 과제 유형을 추가/수정할 때 사용하는 검증.
 * 최대 8개, 이름 중복 불가, 이름 필수, 지정 개수는 1 이상.
 */
export function validateAssignmentTypeInput(
  input: AssignmentTypeInput,
  existing: AssignmentType[],
  editingId?: string,
): string[] {
  const errors: string[] = [];
  const name = input.name.trim();
  if (!name) errors.push("과제 이름을 입력하세요.");
  if (!input.targetCount || input.targetCount < 1) errors.push("지정 개수는 1 이상이어야 합니다.");

  const others = existing.filter((e) => e.id !== editingId);
  if (name && others.some((e) => e.name === name)) {
    errors.push(`이미 같은 이름("${name}")의 과제 유형이 있습니다 — 중복될 수 없습니다.`);
  }
  if (!editingId && others.length >= MAX_ASSIGNMENT_TYPES) {
    errors.push(`과제 유형은 최대 ${MAX_ASSIGNMENT_TYPES}개까지 등록할 수 있습니다.`);
  }
  return errors;
}

export interface SubmissionInput {
  round: number;
  score: number | null;
  wrongNumbers: number[];
}

export function validateSubmissionInput(input: SubmissionInput): string[] {
  const errors: string[] = [];
  if (!input.round || input.round < 1) errors.push("회차는 1 이상이어야 합니다.");
  if (input.score != null && input.score < 0) errors.push("점수는 0 이상이어야 합니다.");
  return errors;
}

export interface GeneralSubmissionInput {
  item: string;
  scope: string;
  completed: boolean;
}

/**
 * 모의고사 외 일반 과제 제출 검증 — 항목/범위는 필수, 완료여부는 true/false 둘 다 유효.
 */
export function validateGeneralSubmissionInput(input: GeneralSubmissionInput): string[] {
  const errors: string[] = [];
  if (!input.item.trim()) errors.push("항목을 입력하세요.");
  if (!input.scope.trim()) errors.push("범위를 입력하세요.");
  return errors;
}

export interface MockExamTimingInput {
  totalMinutes?: number;
  step1Minutes?: number;
  step2Minutes?: number;
  step3Minutes?: number;
}

/**
 * 모의고사 세부풀이시간 입력 검증 — 전부 선택이며, 입력하면 음수는 불가.
 */
export function validateMockExamTimingInput(input: MockExamTimingInput): string[] {
  const errors: string[] = [];
  const fields: [string, number | undefined][] = [
    ["전체 소요시간", input.totalMinutes],
    ["Step1 소요시간", input.step1Minutes],
    ["Step2 소요시간", input.step2Minutes],
    ["Step3 소요시간", input.step3Minutes],
  ];
  for (const [label, value] of fields) {
    if (value != null && value < 0) errors.push(`${label}은 0 이상이어야 합니다.`);
  }
  return errors;
}

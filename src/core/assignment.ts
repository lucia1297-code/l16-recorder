export const MAX_ASSIGNMENT_TYPES = 8;

export interface AssignmentType {
  id: string;
  name: string;
  targetCount: number; // 지정 과제 수 (예: 모의고사 풀이 3회분)
}

export interface AssignmentSubmission {
  id: string;
  studentCode: string;
  typeId: string;
  round: number; // 몇 회차인지 — 자유 등록 가능 (지정 회차를 넘어가도 됨)
  score: number | null; // 점수 (선택)
  wrongNumbers: number[]; // 틀린 문항 번호 (자유 입력, 선택)
  submittedAt: string; // ISO
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

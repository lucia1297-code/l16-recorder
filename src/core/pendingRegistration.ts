export interface PendingRegistration {
  phone: string; // normalized digits
  name: string;
  school: string;
  grade: string;
  requestedAt: string; // ISO
}

export interface PendingInput {
  name: string;
  school: string;
  grade: string;
  phone: string;
}

export function validatePendingRegistration(input: PendingInput): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("이름을 입력하세요.");
  if (!input.school.trim()) errors.push("학교를 입력하세요.");
  if (!input.grade.trim()) errors.push("학년을 선택하세요.");
  return errors;
}

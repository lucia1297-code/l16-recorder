import type { AssignmentType, AssignmentSubmission } from "../core/assignment";

export interface AssignmentStore {
  // 과제 유형 (관리자 관리, 최대 8개)
  listTypes(): Promise<AssignmentType[]>;
  saveType(type: AssignmentType): Promise<void>;
  deleteType(id: string): Promise<void>;

  // 과제 제출 (학생)
  submit(entry: AssignmentSubmission): Promise<void>;
  updateSubmission(id: string, patch: Partial<AssignmentSubmission>): Promise<void>;
  listSubmissions(): Promise<AssignmentSubmission[]>;
  listSubmissionsForStudent(studentCode: string): Promise<AssignmentSubmission[]>;
}

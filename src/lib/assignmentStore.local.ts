import type { AssignmentStore } from "./assignmentStore";
import type { AssignmentType, AssignmentSubmission } from "../core/assignment";

const TYPES_KEY = "asx.assignment.types";
const SUBMISSIONS_KEY = "asx.assignment.submissions";

export class LocalAssignmentStore implements AssignmentStore {
  async listTypes(): Promise<AssignmentType[]> {
    const raw = localStorage.getItem(TYPES_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as AssignmentType[];
    } catch {
      return [];
    }
  }

  async saveType(type: AssignmentType): Promise<void> {
    const all = await this.listTypes();
    const idx = all.findIndex((t) => t.id === type.id);
    if (idx >= 0) all[idx] = type;
    else all.push(type);
    localStorage.setItem(TYPES_KEY, JSON.stringify(all));
  }

  async deleteType(id: string): Promise<void> {
    const all = await this.listTypes();
    localStorage.setItem(TYPES_KEY, JSON.stringify(all.filter((t) => t.id !== id)));
  }

  async submit(entry: AssignmentSubmission): Promise<void> {
    const all = await this.listSubmissions();
    all.push(entry);
    localStorage.setItem(SUBMISSIONS_KEY, JSON.stringify(all));
  }

  async listSubmissions(): Promise<AssignmentSubmission[]> {
    const raw = localStorage.getItem(SUBMISSIONS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as AssignmentSubmission[];
    } catch {
      return [];
    }
  }

  async listSubmissionsForStudent(studentCode: string): Promise<AssignmentSubmission[]> {
    const all = await this.listSubmissions();
    return all.filter((s) => s.studentCode === studentCode);
  }
}

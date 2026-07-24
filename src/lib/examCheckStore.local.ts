import type { ExamCheckStore } from "./examCheckStore";
import type { ExamCheckRecord } from "../core/examCheck";

const KEY = "asx.examChecks";

export class LocalExamCheckStore implements ExamCheckStore {
  async submit(record: ExamCheckRecord): Promise<void> {
    const all = await this.listAll();
    all.push(record);
    localStorage.setItem(KEY, JSON.stringify(all));
  }

  async listAll(): Promise<ExamCheckRecord[]> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ExamCheckRecord[];
    } catch {
      return [];
    }
  }
}

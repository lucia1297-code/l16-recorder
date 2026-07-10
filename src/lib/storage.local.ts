import type { Storage } from "./storage";
import type { ExamResult, DraftResult } from "../core/types";

const RESULTS_KEY = "asx.results";
const DRAFT_KEY = "asx.draft";

export class LocalStorage implements Storage {
  async saveResult(r: ExamResult): Promise<void> {
    const all = await this.listResults();
    all.push(r);
    localStorage.setItem(RESULTS_KEY, JSON.stringify(all));
  }

  async listResults(): Promise<ExamResult[]> {
    const raw = localStorage.getItem(RESULTS_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ExamResult[];
    } catch {
      return [];
    }
  }

  async saveDraft(d: DraftResult): Promise<void> {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  }

  async loadDraft(): Promise<DraftResult | null> {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as DraftResult;
    } catch {
      return null;
    }
  }

  async clearDraft(): Promise<void> {
    localStorage.removeItem(DRAFT_KEY);
  }
}

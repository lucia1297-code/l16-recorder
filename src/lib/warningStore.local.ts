import type { WarningStore } from "./warningStore";
import type { WarningRecord } from "../core/warning";

const KEY = "asx.warnings";

export class LocalWarningStore implements WarningStore {
  async listAll(): Promise<WarningRecord[]> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as WarningRecord[];
    } catch {
      return [];
    }
  }

  async saveAll(records: WarningRecord[]): Promise<void> {
    localStorage.setItem(KEY, JSON.stringify(records));
  }
}

import type { RosterEntry } from "../core/roster";

export interface RosterStore {
  /** 기존 명부에 병합 저장 (같은 학생코드는 덮어씀) */
  saveRoster(entries: RosterEntry[]): Promise<void>;
  listRoster(): Promise<RosterEntry[]>;
  findByPhone(phoneDigits: string): Promise<RosterEntry | null>;
  clearRoster(): Promise<void>;
}
